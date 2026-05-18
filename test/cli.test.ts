import { describe, expect, it } from "vitest";
import {
	MAX_PROCESS_OUTPUT_BYTES,
	PROCESS_TIMEOUT_MS,
	type ProcessExecutor,
	runCommentChecker,
	spawnProcess,
} from "../src/cli.ts";
import type { CommentCheckerHookInput } from "../src/core.ts";

function makeHookInput(): CommentCheckerHookInput {
	return {
		session_id: "session-1",
		tool_name: "Write",
		transcript_path: "",
		cwd: "/workspace",
		hook_event_name: "PostToolUse",
		tool_input: {
			file_path: "src/example.ts",
			content: "const value = 1;\n",
		},
	};
}

describe("runCommentChecker", () => {
	it("#given noisy checker process #when output exceeds cap #then stderr is bounded", async () => {
		// given
		const maxOutputBytes = 16;

		// when
		const result = await spawnProcess(
			process.execPath,
			["-e", "process.stderr.write('x'.repeat(40)); process.exit(2);"],
			"",
			maxOutputBytes,
		);

		// then
		expect(MAX_PROCESS_OUTPUT_BYTES).toBeGreaterThan(maxOutputBytes);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe(`${"x".repeat(maxOutputBytes)}\n[stderr truncated after 16 bytes]`);
	});

	it("#given multibyte process output #when cap splits a character #then stderr keeps valid UTF-8", async () => {
		// given
		const maxOutputBytes = 1;

		// when
		const result = await spawnProcess(
			process.execPath,
			["-e", "process.stderr.write('🙂'); process.exit(2);"],
			"",
			maxOutputBytes,
		);

		// then
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe("\n[stderr truncated after 1 bytes]");
	});

	it("#given hanging checker process #when timeout expires #then returns bounded error", async () => {
		// given
		const processTimeoutMs = 50;

		// when
		const result = await spawnProcess(
			process.execPath,
			["-e", "setInterval(() => {}, 1000);"],
			"",
			MAX_PROCESS_OUTPUT_BYTES,
			processTimeoutMs,
		);

		// then
		expect(PROCESS_TIMEOUT_MS).toBeGreaterThan(processTimeoutMs);
		expect(result.exitCode).toBeNull();
		expect(result.stderr).toBe("comment-checker process timed out after 50 ms");
	});

	it("#given noisy hanging checker process #when timeout expires #then timeout reason is preserved", async () => {
		// given
		const maxOutputBytes = 128;
		const processTimeoutMs = 50;

		// when
		const result = await spawnProcess(
			process.execPath,
			["-e", "process.stderr.write('x'.repeat(512)); setInterval(() => {}, 1000);"],
			"",
			maxOutputBytes,
			processTimeoutMs,
		);

		// then
		expect(result.exitCode).toBeNull();
		expect(result.stderr).toBe("comment-checker process timed out after 50 ms");
	});

	it("#given executor exit zero #when running checker #then returns pass and sends hook JSON", async () => {
		// given
		const input = makeHookInput();
		const calls: Array<{ command: string; args: string[]; stdin: string }> = [];
		const executor: ProcessExecutor = async (command, args, stdin) => {
			calls.push({ command, args, stdin });
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		// when
		const result = await runCommentChecker(input, {
			binaryPath: "/bin/comment-checker",
			executor,
		});

		// then
		expect(result).toEqual({
			status: "pass",
			message: "",
			binaryPath: "/bin/comment-checker",
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
		expect(calls).toEqual([
			{
				command: "/bin/comment-checker",
				args: ["check"],
				stdin: JSON.stringify(input),
			},
		]);
	});

	it("#given executor exit two #when running checker #then returns warning with stderr message", async () => {
		// given
		const executor: ProcessExecutor = async () => ({
			exitCode: 2,
			stdout: "",
			stderr: "COMMENT DETECTED",
		});

		// when
		const result = await runCommentChecker(makeHookInput(), {
			binaryPath: "/bin/comment-checker",
			executor,
		});

		// then
		expect(result.status).toBe("warning");
		expect(result.message).toBe("COMMENT DETECTED");
	});

	it("#given custom prompt #when running checker #then forwards prompt flag", async () => {
		// given
		const calls: string[][] = [];
		const executor: ProcessExecutor = async (_command, args) => {
			calls.push(args);
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		// when
		await runCommentChecker(makeHookInput(), {
			binaryPath: "/bin/comment-checker",
			customPrompt: "Fix this {{comments}}",
			executor,
		});

		// then
		expect(calls).toEqual([["check", "--prompt", "Fix this {{comments}}"]]);
	});

	it("#given missing binary #when running checker #then returns missing without executor call", async () => {
		// given
		let called = false;
		const executor: ProcessExecutor = async () => {
			called = true;
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		// when
		const result = await runCommentChecker(makeHookInput(), {
			resolveBinary: () => undefined,
			executor,
		});

		// then
		expect(result.status).toBe("missing");
		expect(called).toBe(false);
	});
});
