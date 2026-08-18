# Codex First-Refresh Answer Deduplication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the transient second Codex final answer during the first completed-turn refresh.

**Architecture:** Keep the existing same-turn text reconciliation. Ensure its turn ordinal is calculated from realtime rows after optimistic user echoes have been removed, so one user turn is counted once across server and realtime sources.

**Tech Stack:** React/TypeScript session store, Node test runner, Docker Compose.

---

### Task 1: Reproduce the first-refresh race

**Files:**

- Create: `src/stores/useSessionStore.test.ts`
- Modify: `src/stores/useSessionStore.ts`

1. Construct persisted user/answer rows and realtime optimistic-user/SDK-answer rows.
2. Assert the refresh pruning retains no realtime rows.
3. Run the test and confirm the SDK answer is incorrectly retained.

### Task 2: Use reconciled realtime rows for same-turn matching

**Files:**

- Modify: `src/stores/useSessionStore.ts`

1. Pass `reconciledRealtimeMessages` to same-turn assistant echo checks.
2. Run the focused test and related store tests.
3. Run full tests, build, typecheck, lint, and diff checks.

### Task 3: Release and deploy

1. Commit the fix and update the unpushed local `v1.37.8` annotated tag to the new release commit.
2. Rebuild only the localhost `cloudcli` service.
3. Verify container version, HTTP 200, startup logs, and deployed source.
