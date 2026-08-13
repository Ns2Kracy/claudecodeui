# 9Router OAuth Model Catalog Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use test-driven development and execute each task in order.

**Goal:** Prevent transient Codex OAuth model-discovery timeouts from emptying the configured model catalog or producing a fake `gpt-5.4 (Provider unavailable)` fallback.

**Architecture:** `routing.service.ts` owns an in-memory per-account last-good snapshot and pending-request map shared by settings and provider model callers. It refreshes stale entries independently, merges partial successes, and invalidates freshness after account/provider-node mutations while retaining stale fallback data. The chat hook starts with no invented Codex model and only marks a selected model unavailable after a catalog has successfully loaded.

**Tech Stack:** TypeScript, React hooks, Node test runner, Express services, Docker Compose.

---

### Task 1: Reproduce routing catalog failures

**Files:**

- Modify: `server/modules/routing/tests/routing.service.test.ts`

1. Add deterministic tests for concurrent request coalescing, per-account partial success, stale fallback after expiry, all-first-load failures, and mutation invalidation.
2. Run `npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing.service.test.ts`.
3. Confirm the new tests fail against the current direct `client.listModels()` implementation.

### Task 2: Implement per-account last-good snapshots

**Files:**

- Modify: `server/modules/routing/routing.service.ts`
- Modify only if necessary: `server/modules/providers/services/provider-models.service.ts`

1. Add a private 5-minute per-account snapshot map and per-account pending map inside `createRoutingService`.
2. Fetch active accounts independently through `listProviderModels`.
3. Reuse fresh snapshots and pending requests; on refresh failure return stale data when present.
4. Merge partial successes and fail only when every active account has no usable result.
5. Mark snapshots stale after account, OAuth, test-refresh, or provider-node mutations while retaining last-good values.
6. Run routing and provider model tests until green.

### Task 3: Remove the fake frontend model fallback

**Files:**

- Modify: `src/components/chat/hooks/useChatProviderState.ts`
- Modify: `src/components/chat/hooks/useChatProviderState.test.ts`

1. Add RED tests proving an uninitialized catalog does not append `(Provider unavailable)` and no hardcoded bare Codex default is selected.
2. Initialize the selected Codex model from storage or an empty value.
3. Only append unavailable when a successfully loaded catalog explicitly lacks the selected value.
4. Run the focused hook test until green.

### Task 4: Verify and deploy

1. Run routing, provider, and chat focused tests.
2. Run `npm test`, `npm run typecheck`, changed-file ESLint, and `npm run build`.
3. Rebuild and recreate `cloudcli` without changing volumes.
4. Probe real Codex OAuth and DeepSeek catalogs concurrently and verify qualified `/v1/responses` requests return 200.
5. Inspect logs for new providerModels timeouts and verify `/root` and `/workspaces` mounts remain intact.
