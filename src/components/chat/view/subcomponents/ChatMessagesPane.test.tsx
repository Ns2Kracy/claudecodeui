import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ChatMessagesPane.tsx", import.meta.url),
  "utf8",
);

test("filters provider reasoning before tool grouping and export", () => {
  const filterIndex = source.indexOf(
    "filterMessagesForDisplay(visibleMessages",
  );
  const groupingIndex = source.indexOf("groupConsecutiveTools(displayMessages");

  assert.notEqual(
    filterIndex,
    -1,
    "visible messages must use the display policy",
  );
  assert.ok(
    filterIndex < groupingIndex,
    "hidden reasoning must be removed before grouping",
  );
  assert.match(source, /messages=\{exportMessages\}/);
});
