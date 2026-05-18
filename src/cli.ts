import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CommentCheckerHookInput } from "./core.js";

export type ProcessResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

export const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
export const PROCESS_TIMEOUT_MS = 30_000;

export type ProcessExecutor = (command: string, args: string[], stdin: string) => Promise<ProcessResult>;

export type RunCommentCheckerOptions = {
	binaryPath?: string;
	customPrompt?: string;
	resolveBinary?: () => string | undefined;
	executor?: ProcessExecutor;
};

export type CommentCheckerRunResult = {
	status: "pass" | "warning" | "error" | "missing";
	message: string;
	binaryPath?: string;
	exitCode?: number | null;
	stdout?: string;
	stderr?: string;
};

export async function runCommentChecker(
	input: CommentCheckerHookInput,
	options: RunCommentCheckerOptions = {},
): Promise<CommentCheckerRunResult> {
	const binaryPath =
		options.binaryPath ?? (options.resolveBinary ? options.resolveBinary() : resolveCommentCheckerBinary());
	if (!binaryPath) {
		return {
			status: "missing",
			message: "comment-checker binary not found. Install @code-yeongyu/comment-checker or reload the package.",
		};
	}

	const args = ["check"];
	if (options.customPrompt) {
		args.push("--prompt", options.customPrompt);
	}

	const executor = options.executor ?? spawnProcess;
	const result = await executor(binaryPath, args, JSON.stringify(input));
	const message = result.stderr || result.stdout;
	if (result.exitCode === 0) {
		return {
			status: "pass",
			message: "",
			binaryPath,
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}
	if (result.exitCode === 2) {
		return {
			status: "warning",
			message,
			binaryPath,
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}
	return {
		status: "error",
		message,
		binaryPath,
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

export function resolveCommentCheckerBinary(): string | undefined {
	const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker";
	const fromPackage = resolvePackageBinary(binaryName);
	if (fromPackage) return fromPackage;
	return undefined;
}

function resolvePackageBinary(binaryName: string): string | undefined {
	try {
		const require = createRequire(import.meta.url);
		const packagePath = require.resolve("@code-yeongyu/comment-checker/package.json");
		const binaryPath = join(dirname(packagePath), "bin", binaryName);
		return existsSync(binaryPath) ? binaryPath : undefined;
	} catch {
		return undefined;
	}
}

interface OutputAccumulator {
	text: string;
	bytes: number;
	truncated: boolean;
}

function appendOutput(output: OutputAccumulator, chunk: string, maxOutputBytes: number): void {
	if (output.truncated) return;

	const remainingBytes = maxOutputBytes - output.bytes;
	const chunkBytes = Buffer.byteLength(chunk, "utf8");
	if (chunkBytes <= remainingBytes) {
		output.text += chunk;
		output.bytes += chunkBytes;
		return;
	}

	if (remainingBytes > 0) {
		const prefix = truncateUtf8Prefix(chunk, remainingBytes);
		output.text += prefix;
		output.bytes += Buffer.byteLength(prefix, "utf8");
	}
	output.truncated = true;
}

function replaceOutput(output: OutputAccumulator, text: string, maxOutputBytes: number): void {
	output.text = "";
	output.bytes = 0;
	output.truncated = false;
	appendOutput(output, text, maxOutputBytes);
}

function truncateUtf8Prefix(text: string, maxBytes: number): string {
	let bytes = 0;
	let endIndex = 0;
	for (const character of text) {
		const characterBytes = Buffer.byteLength(character, "utf8");
		if (bytes + characterBytes > maxBytes) break;
		bytes += characterBytes;
		endIndex += character.length;
	}
	return text.slice(0, endIndex);
}

function formatOutput(output: OutputAccumulator, streamName: "stdout" | "stderr", maxOutputBytes: number): string {
	if (!output.truncated) return output.text;
	return `${output.text}\n[${streamName} truncated after ${maxOutputBytes} bytes]`;
}

export function spawnProcess(
	command: string,
	args: string[],
	stdin: string,
	maxOutputBytes: number = MAX_PROCESS_OUTPUT_BYTES,
	processTimeoutMs: number = PROCESS_TIMEOUT_MS,
): Promise<ProcessResult> {
	return new Promise((resolve) => {
		const outputByteLimit = Number.isFinite(maxOutputBytes) && maxOutputBytes > 0 ? Math.floor(maxOutputBytes) : 0;
		const timeoutLimit = Number.isFinite(processTimeoutMs) && processTimeoutMs > 0 ? Math.floor(processTimeoutMs) : 0;
		const proc = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});
		const stdout: OutputAccumulator = { text: "", bytes: 0, truncated: false };
		const stderr: OutputAccumulator = { text: "", bytes: 0, truncated: false };
		let settled = false;
		let timedOut = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const timeoutTimer =
			timeoutLimit > 0
				? setTimeout(() => {
						if (settled) return;
						timedOut = true;
						replaceOutput(stderr, `comment-checker process timed out after ${timeoutLimit} ms`, outputByteLimit);
						proc.kill("SIGTERM");
						killTimer = setTimeout(() => {
							if (!settled) proc.kill("SIGKILL");
						}, 1_000);
						killTimer.unref();
					}, timeoutLimit)
				: undefined;
		timeoutTimer?.unref();

		const finish = (exitCode: number | null): void => {
			if (settled) return;
			settled = true;
			if (timeoutTimer) clearTimeout(timeoutTimer);
			if (killTimer) clearTimeout(killTimer);
			resolve({
				exitCode: timedOut ? null : exitCode,
				stdout: formatOutput(stdout, "stdout", outputByteLimit),
				stderr: formatOutput(stderr, "stderr", outputByteLimit),
			});
		};

		proc.stdout.setEncoding("utf-8");
		proc.stderr.setEncoding("utf-8");
		proc.stdout.on("data", (chunk: string) => {
			appendOutput(stdout, chunk, outputByteLimit);
		});
		proc.stderr.on("data", (chunk: string) => {
			appendOutput(stderr, chunk, outputByteLimit);
		});
		proc.once("error", (error) => {
			appendOutput(stderr, error.message, outputByteLimit);
			finish(null);
		});
		proc.once("close", (exitCode) => {
			finish(exitCode);
		});
		proc.stdin.end(stdin);
	});
}
