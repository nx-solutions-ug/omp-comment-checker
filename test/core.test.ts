import { describe, expect, it } from 'vitest';
import {
  extractCommentCheckRequests,
  isToolFailureOutput,
  type ToolResultLike,
  toHookInput,
} from '../src/core.js';

describe('extractCommentCheckRequests', () => {
  it('#given write tool result #when extracting requests #then maps content to a Write hook input', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'write',
      input: {
        filePath: 'src/example.ts',
        content: 'const value = 1;\n',
      },
      content: [{ type: 'text', text: 'wrote src/example.ts' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'write',
        toolName: 'Write',
        filePath: 'src/example.ts',
        toolInput: {
          file_path: 'src/example.ts',
          content: 'const value = 1;\n',
        },
      },
    ]);
  });

  it('#given edit tool result #when extracting requests #then maps old and new strings to an Edit hook input', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'edit',
      input: {
        path: 'src/example.ts',
        old_string: 'const value = 1;',
        new_string: 'const value = 2;',
      },
      content: [{ type: 'text', text: 'edited src/example.ts' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'edit',
        toolName: 'Edit',
        filePath: 'src/example.ts',
        toolInput: {
          file_path: 'src/example.ts',
          old_string: 'const value = 1;',
          new_string: 'const value = 2;',
        },
      },
    ]);
  });
  it('#given edit tool result with perFileResults details #when extracting requests #then maps to Edit and Write hook inputs', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'edit',
      input: { path: 'src/example.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' },
      content: [{ type: 'text', text: 'edited 2 files' }],
      isError: false,
      details: {
        perFileResults: [
          { filePath: 'src/a.ts', oldText: 'a', newText: 'A', success: true },
          { filePath: 'src/b.ts', oldText: '', newText: 'B', success: true },
          { filePath: 'src/c.ts', oldText: 'c', newText: 'C', success: false },
        ],
      },
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'edit',
        toolName: 'Edit',
        filePath: 'src/a.ts',
        toolInput: { file_path: 'src/a.ts', old_string: 'a', new_string: 'A' },
      },
      {
        sourceToolName: 'edit',
        toolName: 'Write',
        filePath: 'src/b.ts',
        toolInput: { file_path: 'src/b.ts', content: 'B' },
      },
    ]);
  });

  it('#given edit tool result with files details (OMO shape) #when extracting requests #then maps to Edit hook inputs', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'edit',
      input: { path: 'src/example.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' },
      content: [{ type: 'text', text: 'edited' }],
      isError: false,
      details: {
        files: [{ file_path: 'src/omo.ts', old_text: 'old', new_text: 'new', success: true }],
      },
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'edit',
        toolName: 'Edit',
        filePath: 'src/omo.ts',
        toolInput: { file_path: 'src/omo.ts', old_string: 'old', new_string: 'new' },
      },
    ]);
  });

  it('#given edit tool result without details #when extracting requests #then falls back to input', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'edit',
      input: { path: 'src/fallback.ts', old_string: 'old', new_string: 'new' },
      content: [{ type: 'text', text: 'edited' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'edit',
        toolName: 'Edit',
        filePath: 'src/fallback.ts',
        toolInput: { file_path: 'src/fallback.ts', old_string: 'old', new_string: 'new' },
      },
    ]);
  });

  it('#given multiedit tool result #when extracting requests #then maps edits to a MultiEdit hook input', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'multiedit',
      input: {
        file_path: 'src/example.ts',
        edits: [
          { old_string: 'const a = 1;', new_string: 'const a = 2;' },
          { oldString: 'const b = 1;', newString: 'const b = 2;' },
        ],
      },
      content: [{ type: 'text', text: 'edited src/example.ts' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'multiedit',
        toolName: 'MultiEdit',
        filePath: 'src/example.ts',
        toolInput: {
          file_path: 'src/example.ts',
          edits: [
            { old_string: 'const a = 1;', new_string: 'const a = 2;' },
            { old_string: 'const b = 1;', new_string: 'const b = 2;' },
          ],
        },
      },
    ]);
  });

  it('#given apply_patch tool result #when extracting requests #then maps add and update hunks to checker inputs', () => {
    // given
    const patch = `*** Begin Patch
*** Add File: src/added.ts
+// explain value
+const value = 1;
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-const before = 1;
+// explain next value
+const after = 2;
*** Delete File: src/deleted.ts
*** End Patch`;
    const event: ToolResultLike = {
      toolName: 'apply_patch',
      input: { input: patch },
      content: [{ type: 'text', text: 'add: src/added.ts\nupdate: src/old.ts -> src/new.ts' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'apply_patch',
        toolName: 'Write',
        filePath: 'src/added.ts',
        toolInput: {
          file_path: 'src/added.ts',
          content: '// explain value\nconst value = 1;\n',
        },
      },
      {
        sourceToolName: 'apply_patch',
        toolName: 'Edit',
        filePath: 'src/new.ts',
        toolInput: {
          file_path: 'src/new.ts',
          old_string: 'const before = 1;\n',
          new_string: '// explain next value\nconst after = 2;\n',
        },
      },
    ]);
  });

  it('#given apply_patch OMO metadata #when extracting requests #then uses full before and after file content', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'apply_patch',
      input: { input: '*** Begin Patch\n*** End Patch' },
      details: {
        files: [
          {
            filePath: 'src/added.ts',
            before: '',
            after: '// explain value\nconst value = 1;\n',
            type: 'add',
          },
          {
            filePath: 'src/old.ts',
            movePath: 'src/new.ts',
            before: 'const before = 1;\n',
            after: '// explain next value\nconst after = 2;\n',
            type: 'update',
          },
          {
            filePath: 'src/deleted.ts',
            before: '// old comment\n',
            after: '',
            type: 'delete',
          },
        ],
      },
      content: [{ type: 'text', text: 'apply_patch ok' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([
      {
        sourceToolName: 'apply_patch',
        toolName: 'Write',
        filePath: 'src/added.ts',
        toolInput: {
          file_path: 'src/added.ts',
          content: '// explain value\nconst value = 1;\n',
        },
      },
      {
        sourceToolName: 'apply_patch',
        toolName: 'Edit',
        filePath: 'src/new.ts',
        toolInput: {
          file_path: 'src/new.ts',
          old_string: 'const before = 1;\n',
          new_string: '// explain next value\nconst after = 2;\n',
        },
      },
    ]);
  });

  it('#given failed tool result #when extracting requests #then returns no work', () => {
    // given
    const event: ToolResultLike = {
      toolName: 'write',
      input: {
        filePath: 'src/example.ts',
        content: 'const value = 1;\n',
      },
      content: [{ type: 'text', text: 'Error: failed to write' }],
      isError: false,
    };

    // when
    const requests = extractCommentCheckRequests(event);

    // then
    expect(requests).toEqual([]);
  });

  it('#given a content field that is not an array #when extracting requests #then treats it as empty content', () => {
    // given
    const event = {
      toolName: 'write',
      input: { filePath: 'src/example.ts', content: 'const value = 1;\n' },
      content: 'not an array' as unknown as ToolResultLike['content'],
      isError: false,
    } as unknown as Parameters<typeof extractCommentCheckRequests>[0];

    // when / then
    expect(() => extractCommentCheckRequests(event)).not.toThrow();
    expect(extractCommentCheckRequests(event).length).toBe(1);
  });

  it('#given a content field that is an object #when extracting requests #then treats it as empty content', () => {
    // given
    const event = {
      toolName: 'write',
      input: { filePath: 'src/example.ts', content: 'const value = 1;\n' },
      content: { not: 'an array' } as unknown as ToolResultLike['content'],
      isError: false,
    } as unknown as Parameters<typeof extractCommentCheckRequests>[0];

    // when / then
    expect(() => extractCommentCheckRequests(event)).not.toThrow();
  });

  it('#given a non-object event #when extracting requests #then returns no work instead of throwing', () => {
    // when / then
    expect(() => extractCommentCheckRequests(null as never)).not.toThrow();
    expect(() => extractCommentCheckRequests(undefined as never)).not.toThrow();
    expect(() => extractCommentCheckRequests('string' as never)).not.toThrow();
    expect(() => extractCommentCheckRequests(42 as never)).not.toThrow();
    expect(extractCommentCheckRequests(null as never)).toEqual([]);
    expect(extractCommentCheckRequests(undefined as never)).toEqual([]);
  });

  it('#given an event missing toolName or input #when extracting requests #then returns no work instead of throwing', () => {
    // when / then
    expect(extractCommentCheckRequests({} as never)).toEqual([]);
    expect(extractCommentCheckRequests({ toolName: 'write' } as never)).toEqual([]);
    expect(extractCommentCheckRequests({ toolName: 'write', input: null } as never)).toEqual([]);
  });
});

describe('toHookInput', () => {
  it('#given comment check request #when converting to hook input #then includes session and cwd', () => {
    // given
    const [request] = extractCommentCheckRequests({
      toolName: 'write',
      input: {
        filePath: 'src/example.ts',
        content: 'const value = 1;\n',
      },
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });
    if (!request) throw new Error('expected a comment check request');

    // when
    const input = toHookInput(request, {
      sessionId: 'session-1',
      cwd: '/workspace',
    });

    // then
    expect(input).toEqual({
      session_id: 'session-1',
      tool_name: 'Write',
      transcript_path: '',
      cwd: '/workspace',
      hook_event_name: 'PostToolUse',
      tool_input: {
        file_path: 'src/example.ts',
        content: 'const value = 1;\n',
      },
    });
  });
});

describe('isToolFailureOutput', () => {
  it('#given failure text #when checking output #then identifies failed tool execution', () => {
    // given
    const text = 'Could not apply patch';

    // when
    const failed = isToolFailureOutput(text);

    // then
    expect(failed).toBe(true);
  });
});
