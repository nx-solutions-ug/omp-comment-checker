import type { ExtensionContextLike } from "./index.js";
import { COMMENT_CHECKER_WIDGET_KEY } from "./ui.js";

export const OMP_WARNING_ENTRY_TYPE = "omp-comment-checker:warning";

export type WarningRecord = {
	id: string;
	filePath: string;
	message: string;
	sourceToolName: string;
	ts: number;
	fired: boolean;
};

type PiHost = {
	appendEntry: (customType: string, data: unknown) => void;
	sendMessage: (message: string, options?: { triggerTurn?: boolean }) => void;
	on: (event: string, handler: () => void) => (() => void) | undefined;
};

export type OmpBackend = {
	/** True if the host supports omp-only UI affordances. */
	readonly available: boolean;
	/** If available, write a sticky footer status line. No-op otherwise. */
	setStatus(ctx: ExtensionContextLike, text: string | undefined): void;
	/** If available, append a non-LLM-visible entry to the session. */
	appendEntry(customType: string, data: unknown): void;
	/** If available, send an LLM-visible custom message. */
	sendMessage(content: string, options?: { triggerTurn?: boolean }): void;
	/** If available, subscribe to post-compaction events. Returns a cleanup fn. */
	onSessionCompact(handler: () => void): () => void;
};

function isPiHost(value: unknown): value is PiHost {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record["appendEntry"] === "function" ||
		typeof record["sendMessage"] === "function" ||
		typeof record["on"] === "function"
	);
}

export function createOmpBackend(pi: unknown): OmpBackend {
	const available = isPiHost(pi);
	const api = (available ? pi : undefined) as Partial<PiHost> | undefined;

	return {
		available,

		setStatus(ctx, text) {
			if (!available) {
				return;
			}

			const setStatus = ctx.ui.setStatus;
			if (typeof setStatus === "function") {
				setStatus(COMMENT_CHECKER_WIDGET_KEY, text);
			}
		},

		appendEntry(customType, data) {
			api?.appendEntry?.(customType, data);
		},

		sendMessage(content, options) {
			api?.sendMessage?.(content, options);
		},

		onSessionCompact(handler) {
			if (!api?.on) {
				return () => {
					/* no-op */
				};
			}
			const off = api.on("session_compact", handler);
			if (typeof off === "function") {
				return off;
			}
			return () => {
				/* no-op */
			};
		},
	};
}
