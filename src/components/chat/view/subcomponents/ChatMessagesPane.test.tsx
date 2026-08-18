import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ChatMessagesPane.tsx", import.meta.url),
  "utf8",
);

test("filters provider reasoning before tool grouping and export", () => {
  const filterIndex = source.indexOf("filterMessagesForDisplay(");
  const mergeIndex = source.indexOf(
    "mergeConsecutiveCodexReasoning(visibleMessages",
    filterIndex,
  );
  const groupingIndex = source.indexOf("groupConsecutiveTools(displayMessages");

  assert.notEqual(
    filterIndex,
    -1,
    "visible messages must use the display policy",
  );
  assert.ok(
    filterIndex < mergeIndex && mergeIndex < groupingIndex,
    "raw reasoning must be merged inside the display filter before tool grouping",
  );
  assert.match(source, /messages=\{exportMessages\}/);
});
