import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useChatRealtimeHandlers.ts", import.meta.url),
  "utf8",
);

test("promotes Codex reasoning headings to the activity status", () => {
  assert.match(source, /parseCodexReasoningSummary/);
  assert.match(source, /case ['"]thinking['"]/);
  assert.match(source, /statusText:\s*summary\.statusLabel/);
});
