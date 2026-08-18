# Codex Final-Answer-Only Display Design

**Date:** 2026-08-17

## Problem

Codex emits reasoning summaries, commentary/progress messages, and a final answer. CloudCLI currently renders commentary and the final answer as ordinary assistant messages while also rendering reasoning in the thinking disclosure. Commentary often paraphrases reasoning, so users see repetitive content.

## Approved behavior

- Keep Codex reasoning as expandable thinking content.
- Keep tool activity visible.
- Do not render Codex commentary as ordinary assistant messages.
- Render only the final assistant message for each live Codex turn.
- When loading transcript history, ignore assistant messages whose `phase` is `commentary`.
- Preserve assistant messages with `phase: final_answer` and legacy messages without a phase.
- Do not change the existing “show thinking” preference or its default.

## Implementation

For live SDK events, buffer completed `agent_message` items and replace the buffer whenever another agent message arrives in the same turn. Flush only the last buffered agent message immediately before processing `turn.completed`. This mirrors `@openai/codex-sdk`’s own `run()` behavior, which treats the last completed agent message as `finalResponse`.

For persisted JSONL history, skip top-level assistant `response_item.message` records marked `phase: commentary`. Existing reasoning normalization remains unchanged.

## Verification

Regression tests cover live event filtering and transcript history. Targeted provider tests, typecheck, lint, and build verify integration.
