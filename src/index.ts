import { type CommentCheckerRunResult, resolveCommentCheckerBinary, runCommentChecker } from "./cli.js";
import {
	type CommentCheckerHookInput,
	extractCommentCheckRequests,
	type ToolCallHandlerResult,
	type ToolCallLike,
	type ToolResultContent,
	type ToolResultLike,
	toHookInput,
} from "./core.js";
import { createOmpBackend, OMP_WARNING_ENTRY_TYPE } from "./omp.js";
import { SelfHealStore } from "./self-heal.js";

type ExtensionApiLike = {
	on: <E extends string>(
		event: E,
		handler: (event: unknown, ctx: ExtensionContextLike) => Promise<unknown> | unknown,
	) => void;
	registerCommand: (
		name: string,
		spec: { description: string; handler: (args: string[], ctx: ExtensionContextLike) => Promise<void> | void },
	) => void;
};

export type ExtensionContextLike = {
	cwd: string;
	sessionManager?: {
		getSessionId?: () => string;
		getHeader?: () => { id?: string } | null;
	};
	ui: {
		notify?: (message: string, level?: "info" | "warning" | "error") => void;
	};
};

export type ToolResultHandlerResult = {
	content?: ToolResultContent[];
	isError?: boolean;
};

export type CommentCheckerHandlerDeps = {
	run?: (input: CommentCheckerHookInput) => Promise<CommentCheckerRunResult>;
	onWarning?: (warning: { filePath: string; message: string; sourceToolName: string }) => void;
};

export default function ompCommentCheckerExtension(pi: unknown): void {
	const api = pi as ExtensionApiLike;
	const backend = createOmpBackend(pi);
	const store = new SelfHealStore();

	const runChecker = (input: CommentCheckerHookInput) => runCommentChecker(input);
	const onWarning = (warning: { filePath: string; message: string; sourceToolName: string }): void => {
		const record = store.record(warning);
		backend.appendEntry(OMP_WARNING_ENTRY_TYPE, {
			filePath: record.filePath,
			message: record.message,
			sourceToolName: record.sourceToolName,
			ts: record.ts,
			id: record.id,
		});
	};

	api.on("session_start", async () => {
		store.clear();
	});

	api.on(
		"tool_call",
		createCommentCheckerToolCallHandler({
			run: runChecker,
			onWarning,
		}) as (event: unknown, ctx: ExtensionContextLike) => Promise<unknown>,
	);

	api.on(
		"tool_result",
		createCommentCheckerToolResultHandler({
			run: runChecker,
			onWarning,
		}) as (event: unknown, ctx: ExtensionContextLike) => Promise<ToolResultHandlerResult | undefined>,
	);

	api.on("session_compact", async () => {
		const unfired = store.unfired();
		if (unfired.length === 0) return;
		const summary = unfired.map((w) => `• ${w.filePath}: ${w.message}`).join("\n");
		backend.sendMessage(
			`omp-comment-checker self-heal: ${unfired.length} warning(s) still need addressing:\n${summary}`,
			{ triggerTurn: false },
		);
		store.markFired(unfired.map((w) => w.id));
	});

	api.registerCommand("omp-comment-checker", {
		description: "Show omp-comment-checker status and pending warnings.",
		handler: async (_args: string[], ctx: ExtensionContextLike) => {
			if (!resolveCommentCheckerBinary()) {
				ctx.ui.notify?.("omp-comment-checker binary missing; reinstall @code-yeongyu/comment-checker.", "warning");
				return;
			}
			const unfired = store.unfired();
			if (unfired.length === 0) {
				ctx.ui.notify?.("omp-comment-checker: no pending warnings.", "info");
				return;
			}
			const summary = unfired.map((w) => `${w.filePath}: ${w.message}`).join("\n");
			ctx.ui.notify?.(`${unfired.length} pending warning(s):\n${summary}`, "warning");
		},
	});
}

type Warning = { filePath: string; message: string; sourceToolName: string };

type CheckerRunOutcome = {
	checkedFiles: string[];
	warnings: Warning[];
	missing: boolean;
	errorMessage: string | null;
};

async function runChecks(
	requests: ReturnType<typeof extractCommentCheckRequests>,
	runner: (input: CommentCheckerHookInput) => Promise<CommentCheckerRunResult>,
	ctx: ExtensionContextLike,
): Promise<CheckerRunOutcome> {
	const checkedFiles: string[] = [];
	const warnings: Warning[] = [];
	let missing = false;
	let errorMessage: string | null = null;

	for (const request of requests) {
		const input = toHookInput(request, { sessionId: getSessionId(ctx), cwd: ctx.cwd });
		const result = await runner(input);
		if (result.status === "missing") {
			missing = true;
			break;
		}
		if (result.status === "error") {
			errorMessage = result.message;
			break;
		}
		checkedFiles.push(request.filePath);
		if (result.status === "warning" && result.message.trim().length > 0) {
			warnings.push({
				filePath: request.filePath,
				message: result.message.trim(),
				sourceToolName: request.sourceToolName,
			});
		}
	}

	return { checkedFiles, warnings, missing, errorMessage };
}

function formatBlockReason(warnings: Warning[]): string {
	const lines: string[] = [];
	if (warnings.length === 1 && warnings[0] !== undefined) {
		const w = warnings[0];
		lines.push(
			`omp-comment-checker blocked the ${sourceToolNameLabel(w.sourceToolName)} for ${w.filePath}; the file was NOT modified.`,
		);
		lines.push(`Reason: ${w.message}`);
	} else {
		lines.push(`omp-comment-checker blocked ${warnings.length} file(s); none were modified:`);
		for (const w of warnings) {
			lines.push(`• ${w.filePath} (${sourceToolNameLabel(w.sourceToolName)}): ${w.message}`);
		}
	}
	lines.push("");
	lines.push("To override for this call, re-run the tool with `skipCommentCheck: true` in its input.");
	return lines.join("\n");
}

function sourceToolNameLabel(sourceToolName: string): string {
	const lower = sourceToolName.toLowerCase();
	if (lower === "write") return "write";
	if (lower === "edit") return "edit";
	if (lower === "multiedit" || lower === "multi_edit") return "multiedit";
	if (lower === "apply_patch") return "apply_patch";
	return sourceToolName;
}

export function createCommentCheckerToolCallHandler(deps: CommentCheckerHandlerDeps) {
	return async (event: ToolCallLike, ctx: ExtensionContextLike): Promise<ToolCallHandlerResult | undefined> => {
		const toolName = event.toolName.toLowerCase();
		if (toolName !== "write" && toolName !== "edit") return undefined;

		if (!resolveCommentCheckerBinary()) return undefined;

		const skipFlag = (event.input as Record<string, unknown>)["skipCommentCheck"];
		if (skipFlag === true) return undefined;

		const requests = extractCommentCheckRequests(event);
		if (requests.length === 0) return undefined;

		const runner = deps.run ?? ((input: CommentCheckerHookInput) => runCommentChecker(input));
		const outcome = await runChecks(requests, runner, ctx);

		if (outcome.missing || outcome.errorMessage !== null || outcome.warnings.length === 0) {
			return undefined;
		}

		for (const warning of outcome.warnings) {
			deps.onWarning?.(warning);
		}
		return {
			block: true,
			reason: formatBlockReason(outcome.warnings),
		};
	};
}

export function createCommentCheckerToolResultHandler(deps: CommentCheckerHandlerDeps) {
	return async (event: ToolResultLike, ctx: ExtensionContextLike): Promise<ToolResultHandlerResult | undefined> => {
		const skipFlag = (event.input as Record<string, unknown>)["skipCommentCheck"];
		if (skipFlag === true) return undefined;
		const requests = extractCommentCheckRequests(event);
		if (requests.length === 0) return undefined;

		const runner = deps.run ?? ((input: CommentCheckerHookInput) => runCommentChecker(input));
		const outcome = await runChecks(requests, runner, ctx);

		if (outcome.missing || outcome.errorMessage !== null || outcome.warnings.length === 0) {
			return undefined;
		}

		for (const warning of outcome.warnings) {
			deps.onWarning?.(warning);
		}
		return {
			content: [
				...(event.content ?? []),
				...outcome.warnings.map((warning) => ({
					type: "text" as const,
					text: `\n\n${warning.message}`,
				})),
			],
			isError: true,
		};
	};
}

function getSessionId(ctx: ExtensionContextLike): string {
	return ctx.sessionManager?.getSessionId?.() ?? ctx.sessionManager?.getHeader?.()?.id ?? "unknown";
}
