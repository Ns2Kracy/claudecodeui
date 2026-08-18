# Codex Client Event Presentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reproduce the official Codex client’s event filtering, reasoning hierarchy, and output denoising in the web chat.

**Architecture:** Keep provider event normalization intact and add a pure frontend presentation policy for Codex reasoning summaries. Apply it before list grouping, reuse parsed headings for live activity, and render retained summaries with the official client’s low-emphasis bullet treatment.

**Tech Stack:** React 18, TypeScript, Node test runner, OpenAI Codex SDK events.

---

### Task 1: Codex reasoning display policy

**Files:** Create `src/components/chat/utils/reasoningSummary.ts` and its test.

1. Add failing tests for bold headings, placeholders, transcript-only prose, provider filtering, and detailed opt-in.
2. Implement the pure policy and make focused tests pass.

### Task 2: Official-style hierarchy

**Files:** Modify `ChatMessagesPane.tsx`, `MessageComponent.tsx`, its test, UI preferences, and setting labels.

1. Filter hidden reasoning before grouping/export.
2. Render retained Codex summaries as muted italic bullets.
3. Default detailed reasoning off and clarify labels.
4. Run focused frontend tests.

### Task 3: Active status and verification

**Files:** Modify `useChatRealtimeHandlers.ts`.

1. Route Codex reasoning headings to the activity status.
2. Run frontend and Codex provider regressions.
3. Run typecheck, targeted lint, build, and inspect the final diff without changing unrelated files.
