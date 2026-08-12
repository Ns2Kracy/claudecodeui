# Codex-only 9Router Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Codex the only supported coding agent and force its authentication, model discovery, and inference traffic through 9Router while reusing the existing provider login modal.

**Architecture:** Narrow the provider contract first, then replace Codex native auth/model behavior with routing services, enforce routed runtime provenance, migrate frontend defaults and login UI, and finally delete unreachable provider implementations. Preserve historical database rows but reject unsupported providers at all active boundaries.

**Tech Stack:** TypeScript, React, Express, node:test, SQLite, Codex CLI, 9Router REST/OAuth, Docker Compose.

---

### Task 1: Freeze the existing provenance work

**Files:**

- Modify: `server/modules/database/schema.ts`
- Modify: `server/modules/database/migrations.ts`
- Modify: `server/modules/database/repositories/sessions.db.ts`
- Modify: `server/modules/providers/services/provider-models.service.ts`
- Modify: `server/modules/providers/services/provider-runtime.service.ts`
- Modify: `server/modules/websocket/services/chat-websocket.service.ts`
- Test: `server/modules/database/tests/sessions.db.integration.test.ts`
- Test: `server/modules/providers/tests/provider-models.service.test.ts`
- Test: `server/modules/providers/tests/provider-runtime.service.test.ts`

1. Complete the in-progress `model_source` test fixtures and async service changes.
2. Run `npm run typecheck`; expect the existing type errors to be eliminated.
3. Run the three targeted test files with `npm test -- <paths>`; expect PASS.
4. Commit the provenance slice separately.

### Task 2: Define the Codex-only provider contract

**Files:**

- Modify: `server/shared/types.ts`
- Modify: `src/types/app.ts`
- Modify: `server/modules/providers/provider.registry.ts`
- Modify: `server/modules/providers/provider.routes.ts`
- Add/modify tests under `server/modules/providers/tests/`

1. Write failing tests proving `listProviders()` returns only Codex and provider route parsing rejects `claude`, `cursor`, and `opencode`.
2. Run the targeted tests; expect failure under the four-provider registry.
3. Narrow both `LLMProvider` types to `'codex'`, register only `CodexProvider`, and make boundary validation explicit.
4. Run targeted tests and `npm run typecheck`; use compiler errors as the consumer migration ledger.
5. Commit the contract slice.

### Task 3: Replace Codex native authentication with a routing facade

**Files:**

- Modify: `server/modules/providers/list/codex/codex-auth.provider.ts` or replace its provider wiring with a routing-owned adapter
- Modify: `server/modules/providers/services/provider-auth.service.ts`
- Modify: `server/modules/routing/index.ts`
- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/providers/provider.routes.ts`
- Test: `server/modules/providers/tests/*auth*.test.ts`
- Test: `server/modules/routing/tests/routing.service.test.ts`

1. Write failing tests proving Codex auth status is authenticated only when 9Router has a usable Codex/OpenAI account and that local `auth.json` is never consulted.
2. Run targeted tests; expect failure because status currently comes from the Codex filesystem adapter.
3. Expose the smallest routing service query needed by provider auth and wire Codex status to it through the routing module barrel.
4. Preserve the existing auth-status response shape for frontend compatibility.
5. Run targeted tests; expect PASS.
6. Commit the routed-auth backend slice.

### Task 4: Reuse `ProviderLoginModal` for 9Router OAuth

**Files:**

- Modify: `src/components/provider-auth/view/ProviderLoginModal.tsx`
- Create: `src/components/provider-auth/view/ProviderLoginModal.test.tsx`
- Reuse or move: `src/components/settings/view/tabs/nine-router-settings/routingApi.ts`
- Modify: `src/components/provider-auth/hooks/useProviderAuthStatus.ts`
- Modify: `src/components/onboarding/view/Onboarding.tsx`
- Modify: `src/components/settings/view/Settings.tsx`

1. Write a failing component test proving opening the Codex modal calls `/api/routing/oauth/codex/authorize`, never renders `codex login`, handles callback completion, and shows retryable errors.
2. Run the component test; expect failure with the current terminal shell.
3. Keep the modal overlay/header/layout but replace `StandaloneShell` with OAuth status/actions using the existing routing API contract.
4. On success, refresh provider auth status; ensure popup cancellation and expiry remain retryable.
5. Run modal, onboarding, settings, and routing API tests; expect PASS.
6. Commit the routed-login UI slice.

### Task 5: Make Codex model discovery route-only

**Files:**

- Modify: `server/modules/providers/services/provider-models.service.ts`
- Modify: `server/modules/providers/list/codex/codex-models.provider.ts` or remove its native discovery responsibility
- Modify: `server/modules/routing/routing-runtime.service.ts`
- Modify: `server/shared/types.ts`
- Test: `server/modules/providers/tests/provider-models.service.test.ts`
- Test: `server/modules/routing/tests/routing-runtime.service.test.ts`

1. Write failing tests proving the Codex catalog contains only 9Router models, is empty without configured routed accounts, preserves exact upstream IDs, and never fabricates a native default.
2. Run targeted tests; expect failures where native models are merged.
3. Remove native catalog merging for Codex and require every option source to be `9router`.
4. Make empty/unavailable upstream results fail closed without silently using a stale native default.
5. Run targeted tests; expect PASS.
6. Commit the route-only model slice.

### Task 6: Enforce route-only Codex runtime

**Files:**

- Modify: `server/modules/providers/services/provider-runtime.service.ts`
- Modify: `server/modules/providers/list/codex/codex-runtime.provider.js`
- Modify: `server/modules/routing/routing-runtime.service.ts`
- Modify: `server/modules/websocket/services/chat-websocket.service.ts`
- Test: `server/modules/providers/tests/provider-runtime.service.test.ts`
- Test: `server/modules/providers/list/codex/codex-runtime.provider.test.ts`

1. Write failing tests proving native provenance, missing routing credentials, and unknown models reject before spawning Codex; routed configuration reaches the Codex process environment/options unchanged.
2. Run targeted tests; expect the native path to violate these assertions.
3. Require `modelSource === '9router'`, resolve 9Router runtime configuration, and remove native fallback branches.
4. Ensure the model is passed exactly as returned by 9Router; do not add `9router:`.
5. Run targeted tests; expect PASS.
6. Commit the runtime enforcement slice.

### Task 7: Migrate frontend defaults and remove provider selection

**Files:**

- Modify: `src/components/provider-auth/types.ts`
- Modify: `src/hooks/useProjectsState.ts`
- Modify: `src/components/chat/hooks/useChatProviderState.ts`
- Modify: `src/components/chat/view/ChatInterface.tsx`
- Modify: `src/components/onboarding/view/subcomponents/AgentConnectionsStep.tsx`
- Modify: `src/components/settings/view/tabs/agents-settings/*`
- Modify remaining files reported by `npm run typecheck`
- Update relevant frontend tests.

1. Write/update tests proving new sessions and projects use Codex and no provider selector exposes removed agents.
2. Run targeted tests; expect failure against current defaults/options.
3. Replace defaults with Codex, reduce auth status maps to Codex, and remove provider-selection UI while retaining Codex capability-specific controls.
4. Use `npm run typecheck` to migrate all real consumers; do not change CSS `cursor-*` tokens or unrelated prose matches.
5. Run frontend tests and typecheck; expect PASS.
6. Commit the frontend Codex-only slice.

### Task 8: Delete removed provider implementations and dead UI

**Files:**

- Delete: `server/modules/providers/list/claude/`
- Delete: `server/modules/providers/list/cursor/`
- Delete: `server/modules/providers/list/opencode/`
- Delete unreferenced Claude/Cursor/OpenCode logos and provider-specific components/tests.
- Modify: `server/modules/providers/README.md`
- Modify package metadata/docs only where they describe supported in-app agents.

1. Run `rg` for imports and supported-provider literals to produce the deletion ledger.
2. Delete only files with no remaining supported consumer; preserve generic transcript compatibility fields needed to read historical rows.
3. Run `npm run typecheck` and targeted provider/session tests; fix references rather than restoring dead providers.
4. Run `rg -n "ClaudeProvider|CursorProvider|OpenCodeProvider|codex login" server src`; expect no active implementation/login matches.
5. Commit the deletion slice.

### Task 9: End-to-end verification

**Files:**

- Modify tests only if a real uncovered defect is found.

1. Run targeted provider, routing, database, websocket, modal, settings, onboarding, and chat tests.
2. Run `npm run typecheck`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Run the full `npm test` once after all code changes.
6. Rebuild/recreate Docker Compose and probe: only Codex is exposed, login uses 9Router, models come from configured accounts, a Codex send reaches 9Router, and sidecar outage fails closed.
7. Run secret scanning on the staged diff and review `git diff --check`.
8. Commit final test/documentation corrections.
