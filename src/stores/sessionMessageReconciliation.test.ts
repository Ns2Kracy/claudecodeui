import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedMessage } from "./useSessionStore";
import {
  removeOptimisticUserEchoes,
  upsertRealtimeMessages,
} from "./sessionMessageReconciliation";

const createUserMessage = (
  id: string,
  timestamp: string,
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
  id,
  sessionId: "session-1",
  timestamp,
  provider: "claude",
  kind: "text",
  role: "user",
  content: "",
  ...overrides,
});

test("replayed reasoning with the same canonical id replaces its realtime copy", () => {
  const first: NormalizedMessage = {
    id: "reasoning-1",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:00.000Z",
    provider: "codex",
    kind: "thinking",
    content: "Thought for a few seconds",
  };
  const replayed = {
    ...first,
    timestamp: "2026-08-18T09:00:01.000Z",
  };

  assert.deepEqual(upsertRealtimeMessages([first], [replayed]), [replayed]);
});

test("identical reasoning with different canonical ids remains distinct", () => {
  const first: NormalizedMessage = {
    id: "reasoning-1",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:00.000Z",
    provider: "codex",
    kind: "thinking",
    content: "Thought for a few seconds",
  };
  const second = { ...first, id: "reasoning-2" };

  assert.deepEqual(upsertRealtimeMessages([first], [second]), [first, second]);
});

test("a replayed id is replaced in place without reordering surrounding activity", () => {
  const before: NormalizedMessage = {
    id: "tool-1",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:00.000Z",
    provider: "codex",
    kind: "tool_use",
    toolName: "Read",
  };
  const reasoning: NormalizedMessage = {
    id: "reasoning-1",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:01.000Z",
    provider: "codex",
    kind: "thinking",
    content: "Inspecting files",
  };
  const after: NormalizedMessage = {
    id: "tool-2",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:02.000Z",
    provider: "codex",
    kind: "tool_use",
    toolName: "Grep",
  };
  const replayed = { ...reasoning, content: "Inspecting relevant files" };

  assert.deepEqual(
    upsertRealtimeMessages([before, reasoning, after], [replayed]),
    [before, replayed, after],
  );
});

test("replaces an optimistic image-only turn with its persisted Claude copy", () => {
  const local = createUserMessage("local_image", "2026-07-28T20:30:21.000Z", {
    images: [
      { path: "C:/Users/test/.cloudcli/assets/upload.png", name: "image.png" },
    ],
  });
  const persisted = createUserMessage(
    "claude_image",
    "2026-07-28T20:30:26.000Z",
    {
      images: [{ data: "data:image/png;base64,AAAA" }],
    },
  );

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
});

test("does not collapse an attachment-only turn into a server row without attachments", () => {
  const local = createUserMessage("local_image", "2026-07-28T20:30:21.000Z", {
    images: [{ path: "C:/Users/test/.cloudcli/assets/upload.png" }],
  });
  const persisted = createUserMessage(
    "claude_empty",
    "2026-07-28T20:30:22.000Z",
  );

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), [local]);
});

test("matches optimistic attachment turns to persisted turns one-to-one", () => {
  const firstLocal = createUserMessage(
    "local_first",
    "2026-07-28T20:30:21.000Z",
    {
      images: [{ path: "C:/Users/test/.cloudcli/assets/first.png" }],
    },
  );
  const secondLocal = createUserMessage(
    "local_second",
    "2026-07-28T20:30:25.000Z",
    {
      images: [{ path: "C:/Users/test/.cloudcli/assets/second.png" }],
    },
  );
  const firstPersisted = createUserMessage(
    "claude_first",
    "2026-07-28T20:30:22.000Z",
    {
      images: [{ data: "data:image/png;base64,AAAA" }],
    },
  );

  const remainingRealtime = removeOptimisticUserEchoes(
    [firstPersisted],
    [firstLocal, secondLocal],
  );

  assert.deepEqual(
    remainingRealtime.map((message) => message.id),
    ["local_second"],
  );
});

test("keeps the existing optimistic text reconciliation behavior", () => {
  const local = createUserMessage("local_text", "2026-07-28T20:30:21.000Z", {
    content: "hello",
  });
  const persisted = createUserMessage(
    "claude_text",
    "2026-07-28T20:30:26.000Z",
    {
      content: "hello",
    },
  );

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
});
