import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractFromOmpEditDetails } from "../src/core.js";
import type { ExtensionContextLike } from "../src/index.ts";
import ompCommentCheckerExtension from "../src/index.ts";
import { createOmpBackend, type WarningRecord } from "../src/omp.js";
import { SelfHealStore } from "../src/self-heal.js";
import { formatFooterStatus } from "../src/ui.js";

describe("SelfHealStore", () => {
	it("#given a fresh store #when recording warnings #then assigns stable ids and returns unfired in order", () => {
		// given
		const store = new SelfHealStore();

		// when
		const a = store.record({ filePath: "src/a.ts", message: "m1", sourceToolName: "write" });
		const b = store.record({ filePath: "src/b.ts", message: "m2", sourceToolName: "edit" });

		// then
		expect(a.id).not.toEqual(b.id);
		expect(a.fired).toBe(false);
		expect(b.fired).toBe(false);
		expect(a.ts).toBeLessThanOrEqual(Date.now());
		expect(store.size()).toBe(2);
		expect(store.unfired()).toEqual([a, b]);
	});

	it("#given recorded warnings #when marking fired #then unfired returns remaining records", () => {
		// given
		const store = new SelfHealStore();
		const a = store.record({ filePath: "src/a.ts", message: "m1", sourceToolName: "write" });
		const b = store.record({ filePath: "src/b.ts", message: "m2", sourceToolName: "edit" });

		// when
		store.markFired([a.id]);

		// then
		expect(store.unfired()).toEqual([b]);
		expect(a.fired).toBe(true);
	});

	it("#given a populated store #when clearing #then removes all records", () => {
		// given
		const store = new SelfHealStore();
		store.record({ filePath: "src/a.ts", message: "m1", sourceToolName: "write" });

		// when
		store.clear();

		// then
		expect(store.size()).toBe(0);
		expect(store.unfired()).toEqual([]);
	});

	it("#given records with varying timestamps #when listing unfired #then returns them sorted by ts", () => {
		// given
		let counter = 0;
		const monotonicNow = () => {
			counter += 1;
			return counter;
		};
		const store = new SelfHealStore();
		const a: WarningRecord = {
			id: crypto.randomUUID(),
			ts: monotonicNow(),
			filePath: "src/a.ts",
			message: "m1",
			sourceToolName: "write",
			fired: false,
		};
		const b: WarningRecord = {
			id: crypto.randomUUID(),
			ts: monotonicNow(),
			filePath: "src/b.ts",
			message: "m2",
			sourceToolName: "edit",
			fired: false,
		};
		store.record(a);
		store.record(b);

		// when
		const unfired = store.unfired();

		// then
		expect(unfired.map((w) => w.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
	});
});

describe("createOmpBackend", () => {
	it("#given a full omp pi #when creating backend #then methods delegate and available is true", () => {
		// given
		const appendCalls: unknown[] = [];
		const messageCalls: unknown[] = [];
		const eventHandlers: Record<string, Array<() => void>> = {};
		const pi = {
			appendEntry: (customType: string, data: unknown) => {
				appendCalls.push([customType, data]);
			},
			sendMessage: (message: string, options?: { triggerTurn?: boolean }) => {
				messageCalls.push([message, options]);
			},
			on: (event: string, handler: () => void) => {
				const handlers = eventHandlers[event] ?? [];
				eventHandlers[event] = handlers;
				handlers.push(handler);
				return () => {
					eventHandlers[event] = eventHandlers[event]?.filter((h) => h !== handler) ?? [];
				};
			},
		};

		// when
		const backend = createOmpBackend(pi);
		backend.appendEntry("type-a", { x: 1 });
		backend.sendMessage("hello", { triggerTurn: true });
		const cleanup = backend.onSessionCompact(() => {
			/* no-op */
		});
		cleanup();

		// then
		expect(backend.available).toBe(true);
		expect(appendCalls).toEqual([["type-a", { x: 1 }]]);
		expect(messageCalls).toEqual([["hello", { triggerTurn: true }]]);
		expect(eventHandlers["session_compact"]).toEqual([]);
	});

	it("#given a partial pi with only appendEntry #when creating backend #then available is true and missing methods are no-ops", () => {
		// given
		const appendCalls: unknown[] = [];
		const pi = {
			appendEntry: (customType: string, data: unknown) => {
				appendCalls.push([customType, data]);
			},
		};

		// when
		const backend = createOmpBackend(pi);
		backend.sendMessage("hello");
		const cleanup = backend.onSessionCompact(() => {
			/* no-op */
		});

		// then
		expect(backend.available).toBe(true);
		expect(appendCalls).toEqual([]);
		expect(typeof cleanup).toBe("function");
	});

	it("#given an empty pi #when creating backend #then available is false and methods are no-ops", () => {
		// given
		const pi = {};

		// when
		const backend = createOmpBackend(pi);
		backend.appendEntry("type-a", { x: 1 });
		backend.sendMessage("hello");
		const cleanup = backend.onSessionCompact(() => {
			/* no-op */
		});

		// then
		expect(backend.available).toBe(false);
		expect(typeof cleanup).toBe("function");
	});

	it("#given a backend and a context with setStatus #when setting status #then delegates to ctx.ui.setStatus", () => {
		// given
		const statusCalls: unknown[] = [];
		const ctx: ExtensionContextLike = {
			cwd: "/workspace",
			ui: {
				setWidget: () => {
					/* no-op */
				},
				setStatus: (key, text) => {
					statusCalls.push([key, text]);
				},
			},
		};
		const pi = {
			appendEntry: () => {
				/* no-op */
			},
		};

		// when
		const backend = createOmpBackend(pi);
		backend.setStatus(ctx, "⚠ warning");

		// then
		expect(statusCalls).toEqual([["pi-comment-checker", "⚠ warning"]]);
	});
});

describe("extractFromOmpEditDetails", () => {
	it("#given omp perFileResults #when extracting #then skips failures and maps write vs edit", () => {
		// given
		const details = {
			perFileResults: [
				{ filePath: "src/a.ts", oldText: "old", newText: "new", success: true },
				{ filePath: "src/b.ts", oldText: "", newText: "content", success: true },
				{ filePath: "src/c.ts", oldText: "x", newText: "y", success: false },
			],
		};

		// when
		const results = extractFromOmpEditDetails(details);

		// then
		expect(results).toEqual([
			{ filePath: "src/a.ts", oldText: "old", newText: "new", success: true, op: "edit" },
			{ filePath: "src/b.ts", oldText: "", newText: "content", success: true, op: "write" },
		]);
	});

	it("#given OMO files details #when extracting #then maps snake_case fields to edit requests", () => {
		// given
		const details = {
			files: [{ file_path: "src/omo.ts", old_text: "old", new_text: "new", success: true }],
		};

		// when
		const results = extractFromOmpEditDetails(details);

		// then
		expect(results).toEqual([{ filePath: "src/omo.ts", oldText: "old", newText: "new", success: true, op: "edit" }]);
	});

	it("#given details without results #when extracting #then returns empty", () => {
		// given
		const details = {};

		// when
		const results = extractFromOmpEditDetails(details);

		// then
		expect(results).toEqual([]);
	});
});

describe("formatFooterStatus", () => {
	it("#given warning state #when formatting footer status #then returns warning summary", () => {
		// given
		const state = {
			status: "warning" as const,
			checkedFiles: ["src/a.ts", "src/b.ts"],
			warnings: [
				{ filePath: "src/a.ts", message: "m1" },
				{ filePath: "src/b.ts", message: "m2" },
			],
		};

		// when
		const status = formatFooterStatus(state);

		// then
		expect(status).toEqual("⚠ comment-checker: 2 warning(s) in src/a.ts, src/b.ts");
	});

	it("#given many warnings #when formatting footer status #then truncates with ellipsis", () => {
		// given
		const state = {
			status: "warning" as const,
			checkedFiles: [],
			warnings: Array.from({ length: 5 }, (_, i) => ({ filePath: `src/${i + 1}.ts`, message: `m${i + 1}` })),
		};

		// when
		const status = formatFooterStatus(state);

		// then
		expect(status).toEqual("⚠ comment-checker: 5 warning(s) in src/1.ts, src/2.ts, src/3.ts …");
	});
});

describe("ompCommentCheckerExtension end-to-end", () => {
	it("#given a warning from edit tool #when session_compact fires #then records one appendEntry per warning and one sendMessage", async () => {
		// given
		const appendCalls: unknown[] = [];
		const messageCalls: unknown[] = [];
		const eventHandlers: Record<string, Array<(event: unknown, ctx: ExtensionContextLike) => unknown>> = {};
		const commandRegistrations: Array<{
			name: string;
			description: string;
			handler: (_args: string[], ctx: ExtensionContextLike) => Promise<void>;
		}> = [];
		const pi: {
			appendEntry: (customType: string, data: unknown) => void;
			sendMessage: (message: string, options?: { triggerTurn?: boolean }) => void;
			on: (
				event: string,
				handler: (event: unknown, ctx: ExtensionContextLike) => unknown,
			) => (() => void) | undefined;
			registerCommand: (
				name: string,
				spec: { description: string; handler: (_args: string[], ctx: ExtensionContextLike) => Promise<void> },
			) => void;
		} = {
			appendEntry: (customType, data) => {
				appendCalls.push([customType, data]);
			},
			sendMessage: (message, options) => {
				messageCalls.push([message, options]);
			},
			on: (event, handler) => {
				const handlers = eventHandlers[event] ?? [];
				eventHandlers[event] = handlers;
				handlers.push(handler);
				return () => {
					eventHandlers[event] = eventHandlers[event]?.filter((h) => h !== handler) ?? [];
				};
			},
			registerCommand: (name, spec) => {
				commandRegistrations.push({ name, description: spec.description, handler: spec.handler });
			},
		};

		// when
		ompCommentCheckerExtension(pi);
		const toolResultHandlers = eventHandlers["tool_result"];
		expect(toolResultHandlers).toBeDefined();
		const toolHandler = toolResultHandlers?.[0];
		expect(toolHandler).toBeDefined();
		await toolHandler?.(
			{
				toolName: "edit",
				input: { path: "src/example.ts", old_string: "old", new_string: "// c\nnew" },
				content: [{ type: "text", text: "edited src/example.ts" }],
				isError: false,
			},
			{
				cwd: "/workspace",
				sessionManager: { getSessionId: () => "session-1" },
				ui: {
					setWidget: () => {
						/* no-op */
					},
					setStatus: () => {
						/* no-op */
					},
					notify: () => {
						/* no-op */
					},
				},
			},
		);

		// then
		expect(appendCalls.length).toBe(1);
		expect((appendCalls[0] as [string, { filePath: string }])[0]).toEqual("omp-comment-checker:warning");
		expect((appendCalls[0] as [string, { filePath: string }])[1].filePath).toEqual("src/example.ts");
		expect(messageCalls).toEqual([]);

		// when session_compact fires with unfired warnings
		const compactHandlers = eventHandlers["session_compact"];
		expect(compactHandlers).toBeDefined();
		await compactHandlers?.[0]?.(
			{},
			{
				cwd: "/workspace",
				ui: {
					setWidget: () => {
						/* no-op */
					},
				},
			},
		);

		// then one sendMessage is recorded
		expect(messageCalls.length).toBe(1);
		const [sentMessage, sentOptions] = messageCalls[0] as [string, { triggerTurn?: boolean }];
		expect(sentOptions).toEqual({ triggerTurn: false });
		expect(sentMessage).toContain("omp-comment-checker self-heal: 1 warning(s) still need addressing:");
		expect(sentMessage).toContain("• src/example.ts:");
	});
});
