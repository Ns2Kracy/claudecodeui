# Codex Final-Answer-Only Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop Codex commentary from appearing as permanent assistant text while preserving reasoning, tools, and final answers.

**Architecture:** Add a tiny stateful live-event filter beside the Codex runtime and apply a phase guard in Codex history parsing. Reuse the SDK’s “last agent message is final” convention instead of adding UI state.

**Tech Stack:** TypeScript/JavaScript, Node test runner, OpenAI Codex SDK, React frontend consuming normalized messages.

---

### Task 1: Reproduce live commentary leakage

**Files:**

- Create: `server/modules/providers/list/codex/codex-visible-event-buffer.provider.ts`
- Modify: `server/modules/providers/list/codex/codex-runtime.provider.test.ts`
- Modify: `server/modules/providers/list/codex/codex-runtime.provider.js`

1. Add a test that feeds commentary, reasoning/tool events, a final agent message, and `turn.completed` into the live visibility filter.
2. Assert commentary is withheld, non-agent events remain immediate, and only the last agent message is emitted at completion.
3. Run the test and confirm it fails before implementation.
4. Implement the minimal typed event buffer and use it in `queryCodex`.
5. Run the test and confirm it passes.

### Task 2: Reproduce history commentary leakage

**Files:**

- Modify: `server/modules/providers/tests/codex-sessions.test.ts`
- Modify: `server/modules/providers/list/codex/codex-sessions.provider.ts`

1. Add a transcript fixture containing reasoning, commentary, final-answer, and legacy no-phase assistant records.
2. Assert history includes reasoning, final-answer, and legacy text but excludes commentary.
3. Run the test and confirm it fails before implementation.
4. Add the minimal `phase !== commentary` guard.
5. Run the test and confirm it passes.

### Task 3: Verify integration

1. Run targeted Codex tests.
2. Run `npm run typecheck`.
3. Run ESLint on touched backend files.
4. Run `npm run build`.
5. Confirm `git diff --check` and ensure unrelated existing changes remain untouched.
