import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "../types/types";

import {
  filterMessagesForDisplay,
  mergeConsecutiveCodexReasoning,
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

test("merges adjacent unstructured Codex reasoning into one block", () => {
  const messages: ChatMessage[] = [
    {
      type: "assistant",
      content: "Inspecting files",
      timestamp: "2026-08-18T00:00:00.000Z",
      isThinking: true,
    },
    {
      type: "assistant",
      content: "Inspecting files",
      timestamp: "2026-08-18T00:00:01.000Z",
      isThinking: true,
    },
    {
      type: "assistant",
      content: "Running tests",
      timestamp: "2026-08-18T00:00:02.000Z",
      isThinking: true,
    },
  ];

  const merged = mergeConsecutiveCodexReasoning(messages, "codex");

  assert.equal(merged.length, 1);
  assert.notEqual(merged[0], messages[0]);
  assert.equal(messages[0].content, "Inspecting files");
  assert.equal(merged[0].content, "Inspecting files\n\nRunning tests");
});

test("preserves distinct full items that normalize to the same display content", () => {
  const first: ChatMessage = {
    type: "assistant",
    content: "Inspecting files",
    timestamp: "2026-08-18T00:00:00.000Z",
    isThinking: true,
  };
  const second: ChatMessage = {
    ...first,
    content: "<!-- -->\n\nInspecting files",
  };

  const merged = mergeConsecutiveCodexReasoning([first, second], "codex");

  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, "Inspecting files\n\nInspecting files");
});

test("does not merge Codex reasoning across a user, tool, or answer boundary", () => {
  const thinking = (content: string, seconds: number): ChatMessage => ({
    type: "assistant",
    content,
    timestamp: `2026-08-18T00:00:0${seconds}.000Z`,
    isThinking: true,
  });
  const boundaries: ChatMessage[] = [
    {
      type: "user",
      content: "Next turn",
      timestamp: "2026-08-18T00:00:01.000Z",
    },
    {
      type: "assistant",
      content: "",
      timestamp: "2026-08-18T00:00:01.000Z",
      isToolUse: true,
      toolName: "Read",
    },
    {
      type: "assistant",
      content: "Final answer",
      timestamp: "2026-08-18T00:00:01.000Z",
    },
  ];

  for (const boundary of boundaries) {
    const first = thinking("Same thought", 0);
    const second = thinking("Same thought", 2);
    assert.deepEqual(
      mergeConsecutiveCodexReasoning([first, boundary, second], "codex"),
      [first, boundary, second],
    );
  }
});

test("does not merge across visible or empty structured summary boundaries", () => {
  const thinking = (content: string): ChatMessage => ({
    type: "assistant",
    content,
    timestamp: "2026-08-18T00:00:00.000Z",
    isThinking: true,
  });
  const first = thinking("Inspecting files");
  const second = thinking("Running tests");
  const boundaries = [
    thinking("**Checking files**"),
    thinking("**Checking files**\n<!-- -->"),
  ];

  for (const boundary of boundaries) {
    assert.deepEqual(
      mergeConsecutiveCodexReasoning([first, boundary, second], "codex"),
      [first, boundary, second],
    );
  }
});

test("does not merge reasoning from other providers", () => {
  const first: ChatMessage = {
    type: "assistant",
    content: "Inspecting files",
    timestamp: "2026-08-18T00:00:00.000Z",
    isThinking: true,
  };
  const second = { ...first, content: "Running tests" };

  assert.deepEqual(mergeConsecutiveCodexReasoning([first, second], "claude"), [
    first,
    second,
  ]);
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
