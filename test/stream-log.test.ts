import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Drive `.omp/stream-log.py` as a subprocess so we exercise the actual CI
 * pipeline shape (`omp -p --mode json "..." | python3 .omp/stream-log.py`).
 *
 * These tests guard against the regressions that caused issue #76
 * ("omp run is failing because of stream-log.py"): the script used to crash
 * with non-zero exit code when tool events carried non-dict `args` or
 * non-string `text` content, which broke the pipe from `omp`.
 */

const SCRIPT = path.resolve(import.meta.dirname, "..", ".omp", "stream-log.py");

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runStreamLog(input: string): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn("python3", [SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", reject);
  child.on("exit", (code) => {
    resolve({ exitCode: code, stdout, stderr });
  });
  child.stdin.end(input);
  return promise;
}

describe("stream-log.py", () => {
  test("formats the canonical event flow without crashing", async () => {
    const input = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls -la" },
        intent: "list files",
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: { content: [{ type: "text", text: "file1.txt\nfile2.txt" }] },
      }),
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "All done." }] },
      }),
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/tmp/foo.txt" },
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: { content: [{ type: "text", text: "short content" }] },
      }),
      JSON.stringify({
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: "final" }] }],
        usage: { totalTokens: 50 },
      }),
    ].join("\n");

    const { exitCode, stdout } = await runStreamLog(input);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("🚀 OMP agent started");
    expect(stdout).toContain("🔧 bash: list files");
    expect(stdout).toContain("✓ bash: file1.txt\\nfile2.txt");
    expect(stdout).toContain("All done.");
    expect(stdout).toContain("🔧 read: /tmp/foo.txt");
    expect(stdout).toContain("✓ read: short content");
    expect(stdout).toContain("✅ Agent finished (2 turns, 50 tokens)");
  });

  test("does not crash when tool_execution_end text is null", async () => {
    // Regression: text: null used to raise TypeError on str.join.
    const input = JSON.stringify({
      type: "tool_execution_end",
      toolName: "bash",
      isError: false,
      result: { content: [{ type: "text", text: null }] },
    });

    const { exitCode, stdout, stderr } = await runStreamLog(input);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("✓ bash: done");
  });

  test("does not crash when tool_execution_end text is non-string", async () => {
    // Regression: numeric/list/dict text used to raise TypeError on str.join.
    const inputs = [
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: { content: [{ type: "text", text: 42 }] },
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: { content: [{ type: "text", text: ["a", "b"] }] },
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: { content: [{ type: "text", text: { foo: "bar" } }] },
      }),
    ].join("\n");

    const { exitCode, stdout, stderr } = await runStreamLog(inputs);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("✓ bash: 42");
    expect(stdout).toContain('✓ bash: ["a","b"]');
    expect(stdout).toContain('✓ bash: {"foo":"bar"}');
  });

  test("does not crash when tool_execution_start args is not a dict", async () => {
    // Regression: read/write/edit handlers used to call .get on the raw
    // value, raising AttributeError for str/null/list args.
    const inputs = [
      JSON.stringify({ type: "tool_execution_start", toolName: "read", args: "string args" }),
      JSON.stringify({ type: "tool_execution_start", toolName: "read", args: null }),
      JSON.stringify({ type: "tool_execution_start", toolName: "read", args: [1, 2, 3] }),
      JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { input: "string" } }),
    ].join("\n");

    const { exitCode, stdout, stderr } = await runStreamLog(inputs);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Each malformed args payload still produces a tool invocation line so the
    // CI log shows the call was attempted.
    expect(stdout.match(/🔧 read:/g)?.length).toBe(4);
  });

  test("does not crash when message_end or agent_end text is non-string", async () => {
    const input = [
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: null }] },
      }),
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: 7 }] },
      }),
      JSON.stringify({
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: null }] }],
        usage: { totalTokens: 10 },
      }),
    ].join("\n");

    const { exitCode, stdout, stderr } = await runStreamLog(input);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("✅ Agent finished (0 turns, 10 tokens)");
  });

  test("skips malformed JSON lines without aborting", async () => {
    const input = [
      "not valid json",
      JSON.stringify({ type: "agent_start" }),
      "{incomplete",
      JSON.stringify({ type: "agent_end", messages: [], usage: {} }),
    ].join("\n");

    const { exitCode, stdout, stderr } = await runStreamLog(input);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("🚀 OMP agent started");
    expect(stdout).toContain("✅ Agent finished");
  });
});
