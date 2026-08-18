import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useUiPreferences.ts", import.meta.url),
  "utf8",
);

test("detailed reasoning is opt-in by default", () => {
  assert.match(source, /showThinking:\s*false/);
});
