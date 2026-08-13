import { describe, expect, it } from "vitest";
import type { CommentCheckerHookInput, ToolCallLike, ToolResultLike } from "../src/core.ts";
import {
	createCommentCheckerToolCallHandler,
	createCommentCheckerToolResultHandler,
	type ExtensionContextLike,
} from "../src/index.ts";

function makeContext(): ExtensionContextLike {
	return {
		cwd: "/workspace",
		sessionManager: {
			getSessionId: () => "session-1",
		},
		ui: {},
	};
}

describe("createCommentCheckerToolResultHandler", () => {
	it("#given apply_patch metadata warning #when handling tool result #then appends checker warning", async () => {
		// given
		const event: ToolResultLike = {
			toolName: "apply_patch",
			input: {},
			details: {
				files: [
					{
						filePath: "src/example.ts",
						before: "const value = 1;\n",
						after: "// explain value\nconst value = 2;\n",
						type: "update",
					},
				],
			},
			content: [{ type: "text", text: "update: src/example.ts" }],
			isError: false,
		};
		const calls: CommentCheckerHookInput[] = [];
		const handler = createCommentCheckerToolResultHandler({
			run: async (input) => {
				calls.push(input);
				return {
					status: "warning",
					message: "COMMENT DETECTED",
					binaryPath: "/bin/comment-checker",
					exitCode: 2,
				};
			},
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(calls).toEqual([
			{
				session_id: "session-1",
				tool_name: "Edit",
				transcript_path: "",
				cwd: "/workspace",
				hook_event_name: "PostToolUse",
				tool_input: {
					file_path: "src/example.ts",
					old_string: "const value = 1;\n",
					new_string: "// explain value\nconst value = 2;\n",
				},
			},
		]);
		expect(result?.content).toEqual([
			{ type: "text", text: "update: src/example.ts" },
			{ type: "text", text: "\n\nCOMMENT DETECTED" },
		]);
		expect(result?.isError).toBe(true);
	});

	it("#given missing binary #when handling write result #then leaves tool output unchanged", async () => {
		// given
		const handler = createCommentCheckerToolResultHandler({
			run: async () => ({
				status: "missing",
				message: "missing",
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(
			{
				toolName: "write",
				input: {
					filePath: "src/example.ts",
					content: "const value = 1;\n",
				},
				content: [{ type: "text", text: "wrote src/example.ts" }],
				isError: false,
			},
			ctx,
		);

		// then
		expect(result).toBeUndefined();
	});

	it("#given write warning #when handling tool result #then appends checker warning", async () => {
		// given
		const event: ToolResultLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "// explain value\nconst value = 1;\n",
			},
			content: [{ type: "text", text: "wrote src/example.ts" }],
			isError: false,
		};
		const handler = createCommentCheckerToolResultHandler({
			run: async () => ({
				status: "warning",
				message: "COMMENT DETECTED",
				binaryPath: "/bin/comment-checker",
				exitCode: 2,
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result?.content).toEqual([
			{ type: "text", text: "wrote src/example.ts" },
			{ type: "text", text: "\n\nCOMMENT DETECTED" },
		]);
	});

	it("#given write clean #when handling tool result #then leaves tool output unchanged", async () => {
		// given
		const event: ToolResultLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "const value = 1;\n",
			},
			content: [{ type: "text", text: "wrote src/example.ts" }],
			isError: false,
		};
		const handler = createCommentCheckerToolResultHandler({
			run: async () => ({
				status: "pass",
				message: "",
				binaryPath: "/bin/comment-checker",
				exitCode: 0,
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
	});

	it("#given edit warning #when handling tool result #then appends checker warning", async () => {
		// given
		const event: ToolResultLike = {
			toolName: "edit",
			input: {
				filePath: "src/example.ts",
				oldString: "const value = 1;\n",
				newString: "// explain value\nconst value = 2;\n",
			},
			content: [{ type: "text", text: "edited src/example.ts" }],
			isError: false,
		};
		const handler = createCommentCheckerToolResultHandler({
			run: async () => ({
				status: "warning",
				message: "COMMENT DETECTED",
				binaryPath: "/bin/comment-checker",
				exitCode: 2,
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result?.content).toEqual([
			{ type: "text", text: "edited src/example.ts" },
			{ type: "text", text: "\n\nCOMMENT DETECTED" },
		]);
	});

	it("#given checker error #when handling tool result #then leaves tool output unchanged", async () => {
		// given
		const event: ToolResultLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "const value = 1;\n",
			},
			content: [{ type: "text", text: "wrote src/example.ts" }],
			isError: false,
		};
		const handler = createCommentCheckerToolResultHandler({
			run: async () => ({
				status: "error",
				message: "checker crashed",
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
	});

	it("#given skipCommentCheck #when handling tool result #then passes through without invoking the checker", async () => {
		// given
		const event: ToolResultLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "// comment\nconst value = 1;\n",
				skipCommentCheck: true,
			},
			content: [{ type: "text", text: "wrote src/example.ts" }],
			isError: false,
		};
		let invocations = 0;
		const handler = createCommentCheckerToolResultHandler({
			run: async () => {
				invocations++;
				return { status: "warning", message: "x", binaryPath: "/bin/cc", exitCode: 2 };
			},
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
		expect(invocations).toBe(0);
	});
});

describe("createCommentCheckerToolCallHandler", () => {
	it("#given a write with bad comments #when handling tool_call #then blocks and surfaces warning to the LLM", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "// explain value\nconst value = 1;\n",
			},
		};
		const calls: CommentCheckerHookInput[] = [];
		const onWarnings: Array<{ filePath: string; message: string; sourceToolName: string }> = [];
		const handler = createCommentCheckerToolCallHandler({
			run: async (input) => {
				calls.push(input);
				return {
					status: "warning",
					message: "COMMENT DETECTED",
					binaryPath: "/bin/comment-checker",
					exitCode: 2,
				};
			},
			onWarning: (warning) => {
				onWarnings.push(warning);
			},
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(calls).toEqual([
			{
				session_id: "session-1",
				tool_name: "Write",
				transcript_path: "",
				cwd: "/workspace",
				hook_event_name: "PostToolUse",
				tool_input: {
					file_path: "src/example.ts",
					content: "// explain value\nconst value = 1;\n",
				},
			},
		]);
		expect(result).toEqual({
			block: true,
			reason:
				"omp-comment-checker blocked the write for src/example.ts; the file was NOT modified.\n" +
				"Reason: COMMENT DETECTED\n" +
				"\n" +
				"To override for this call, re-run the tool with `skipCommentCheck: true` in its input.",
		});
		expect(onWarnings).toEqual([
			{ filePath: "src/example.ts", message: "COMMENT DETECTED", sourceToolName: "write" },
		]);
	});

	it("#given an edit with bad comments #when handling tool_call #then blocks with the checker message as reason", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "edit",
			input: {
				filePath: "src/example.ts",
				oldString: "const value = 1;\n",
				newString: "// explain value\nconst value = 2;\n",
			},
		};
		const handler = createCommentCheckerToolCallHandler({
			run: async () => ({
				status: "warning",
				message: "AI comment detected",
				binaryPath: "/bin/comment-checker",
				exitCode: 2,
			}),
		});
		const ctx = makeContext();
		// when
		const result = await handler(event, ctx);

		expect(result).toEqual({
			block: true,
			reason:
				"omp-comment-checker blocked the edit for src/example.ts; the file was NOT modified.\n" +
				"Reason: AI comment detected\n" +
				"\n" +
				"To override for this call, re-run the tool with `skipCommentCheck: true` in its input.",
		});

		// then
	});

	it("#given a clean write #when handling tool_call #then passes through", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "const value = 1;\n",
			},
		};
		const handler = createCommentCheckerToolCallHandler({
			run: async () => ({
				status: "pass",
				message: "",
				binaryPath: "/bin/comment-checker",
				exitCode: 0,
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
	});

	it("#given skipCommentCheck #when handling tool_call #then passes through without invoking the checker", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "// comment\nconst value = 1;\n",
				skipCommentCheck: true,
			},
		};
		let invocations = 0;
		const handler = createCommentCheckerToolCallHandler({
			run: async () => {
				invocations++;
				return { status: "warning", message: "x", binaryPath: "/bin/cc", exitCode: 2 };
			},
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
		expect(invocations).toBe(0);
	});

	it("#given an apply_patch tool_call #when handling #then passes through (post-hook covers it)", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "apply_patch",
			input: { input: "*** Begin Patch\n*** Add File: src/new.ts\n+// comment\n*** End Patch\n" },
		};
		let invocations = 0;
		const handler = createCommentCheckerToolCallHandler({
			run: async () => {
				invocations++;
				return { status: "warning", message: "x", binaryPath: "/bin/cc", exitCode: 2 };
			},
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
		expect(invocations).toBe(0);
	});

	it("#given a missing binary #when handling tool_call #then passes through", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "write",
			input: { filePath: "src/example.ts", content: "const value = 1;\n" },
		};
		const handler = createCommentCheckerToolCallHandler({
			run: async () => ({ status: "missing", message: "binary not found" }),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result).toBeUndefined();
	});

	it("#given a single warning #when handling tool_call #then reason states the file, that it was not modified, and the override hint (issue 75)", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "write",
			input: {
				filePath: "src/example.ts",
				content: "// comment\nconst value = 1;\n",
			},
		};
		const handler = createCommentCheckerToolCallHandler({
			run: async () => ({
				status: "warning",
				message: "AI comment detected",
				binaryPath: "/bin/comment-checker",
				exitCode: 2,
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then — explicit notice the LLM can act on
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("blocked the write for src/example.ts");
		expect(result?.reason).toContain("the file was NOT modified");
		expect(result?.reason).toContain("AI comment detected");
		expect(result?.reason).toContain("skipCommentCheck: true");
	});

	it("#given an edit source name #when handling tool_call #then reason names the tool as 'edit' (issue 75)", async () => {
		// given
		const event: ToolCallLike = {
			toolName: "edit",
			input: {
				filePath: "src/example.ts",
				oldString: "const value = 1;\n",
				newString: "// explain value\nconst value = 2;\n",
			},
		};
		const handler = createCommentCheckerToolCallHandler({
			run: async () => ({
				status: "warning",
				message: "AI comment detected",
				binaryPath: "/bin/comment-checker",
				exitCode: 2,
			}),
		});
		const ctx = makeContext();

		// when
		const result = await handler(event, ctx);

		// then
		expect(result?.reason).toContain("blocked the edit for src/example.ts");
	});
});
