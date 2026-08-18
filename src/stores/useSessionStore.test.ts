import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedMessage } from "./useSessionStore";
import { pruneRealtimeSupersededByServer } from "./useSessionStore";

const message = (
  id: string,
  timestamp: string,
  role: "user" | "assistant",
  content: string,
): NormalizedMessage => ({
  id,
  sessionId: "session-1",
  timestamp,
  provider: "codex",
  kind: "text",
  role,
  content,
});

test("first refresh removes the SDK answer after reconciling its optimistic user turn", () => {
  const serverMessages = [
    message("persisted-user", "2026-08-18T16:13:08.615Z", "user", "hi"),
    message(
      "msg_resp_1",
      "2026-08-18T16:13:16.238Z",
      "assistant",
      "Hi! What can I help you with today?",
    ),
  ];
  const realtimeMessages = [
    message("local_hi", "2026-08-18T16:13:08.610Z", "user", "hi"),
    message(
      "item_0",
      "2026-08-18T16:13:16.237Z",
      "assistant",
      "Hi! What can I help you with today?",
    ),
  ];

  assert.deepEqual(
    pruneRealtimeSupersededByServer(serverMessages, realtimeMessages),
    [],
  );
});
