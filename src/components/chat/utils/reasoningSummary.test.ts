import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "../types/types";

import {
  filterMessagesForDisplay,
  parseCodexReasoningSummary,
} from "./reasoningSummary";

test("extracts a leading bold heading and keeps its body visible", () => {
  const summary = parseCodexReasoningSummary(
    "**Checking files**\nInspected the provider and message renderer.",
  );

  assert.equal(summary.statusLabel, "Checking files");
  assert.equal(
    summary.displayContent,
    "Inspected the provider and message renderer.",
  );
  assert.equal(summary.transcriptOnly, false);
});

test("keeps a bold-only summary visible as compact status content", () => {
  const summary = parseCodexReasoningSummary("**Running tests**");

  assert.equal(summary.statusLabel, "Running tests");
  assert.equal(summary.displayContent, "**Running tests**");
  assert.equal(summary.transcriptOnly, false);
});

test("drops placeholder-only parts before selecting the visible heading", () => {
  const summary = parseCodexReasoningSummary(
    "**Checking files**\n<!-- -->\n\n**Running tests**\nTests passed.",
  );

  assert.equal(summary.statusLabel, "Running tests");
  assert.equal(summary.displayContent, "Tests passed.");
  assert.equal(summary.transcriptOnly, false);
});

test("drops a standalone empty placeholder part", () => {
  const summary = parseCodexReasoningSummary(
    "<!-- -->\n\n**Running tests**\nTests passed.",
  );

  assert.equal(summary.statusLabel, "Running tests");
  assert.equal(summary.displayContent, "Tests passed.");
});

test("hides a heading whose only body is the empty placeholder", () => {
  const content = "**Checking files**\n<!-- -->";
  const summary = parseCodexReasoningSummary(content);
  const message: ChatMessage = {
    type: "assistant",
    content,
    timestamp: "2026-08-18T00:00:00.000Z",
    isThinking: true,
  };

  assert.equal(summary.statusLabel, "Checking files");
  assert.equal(summary.displayContent, "");
  assert.deepEqual(filterMessagesForDisplay([message], "codex", true), []);
});

test("does not promote a same-line bold phrase to a structured summary", () => {
  const summary = parseCodexReasoningSummary(
    "**Possible approach** continue inspecting the implementation.",
  );

  assert.equal(summary.statusLabel, null);
  assert.equal(summary.transcriptOnly, true);
});

test("keeps a same-line bold placeholder suffix transcript-only", () => {
  const content = "**Possible approach** <!-- -->";
  const summary = parseCodexReasoningSummary(content);

  assert.equal(summary.statusLabel, null);
  assert.equal(summary.displayContent, content);
  assert.equal(summary.transcriptOnly, true);
});

test("classifies unstructured reasoning prose as transcript-only", () => {
  const summary = parseCodexReasoningSummary(
    "I need to inspect the applicable instructions before editing.",
  );

  assert.equal(summary.statusLabel, null);
  assert.equal(summary.transcriptOnly, true);
});

test("filters transcript-only Codex reasoning unless detailed reasoning is enabled", () => {
  const messages: ChatMessage[] = [
    {
      type: "assistant",
      content: "I need to inspect the applicable instructions.",
      timestamp: "2026-08-18T00:00:00.000Z",
      isThinking: true,
    },
    {
      type: "assistant",
      content: "**Checking files**",
      timestamp: "2026-08-18T00:00:01.000Z",
      isThinking: true,
    },
    {
      type: "assistant",
      content: "Done.",
      timestamp: "2026-08-18T00:00:02.000Z",
    },
  ];

  assert.deepEqual(
    filterMessagesForDisplay(messages, "codex", false).map(
      (message: ChatMessage) => message.content,
    ),
    ["**Checking files**", "Done."],
  );
  assert.equal(filterMessagesForDisplay(messages, "codex", true).length, 3);
  assert.deepEqual(filterMessagesForDisplay(messages, "claude", false), [
    messages[2],
  ]);
});
