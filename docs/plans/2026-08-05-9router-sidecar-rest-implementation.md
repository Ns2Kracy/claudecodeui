# 9router Sidecar REST Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bundled 9router child process with an official `9router@0.5.45` Compose sidecar and expose native-agent plus 9router provider-model choices through one CloudCLI model selector and REST execution boundary.

**Architecture:** Compose owns 9router lifecycle and persistence. The backend routing module becomes a bounded, validating REST adapter to `NINE_ROUTER_BASE_URL`; browser and chat clients only call authenticated CloudCLI APIs. Model values use a discriminated native versus `9router:` representation so native agent execution remains unchanged while selected 9router models use the official data-plane REST API.

**Tech Stack:** TypeScript, Express, React, Node test runner, Docker Compose, official `9router@0.5.45`, Vite.

---

### Task 1: Replace child-process runtime with a sidecar health adapter

**Files:**
- Create: `server/modules/routing/nine-router-sidecar.service.ts`
- Create: `server/modules/routing/tests/nine-router-sidecar.service.test.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/modules/routing/routing-runtime.service.ts`
- Modify: `server/modules/routing/index.ts`
- Delete after migration: `server/modules/routing/nine-router-runtime.service.ts`
- Delete after migration: `server/modules/routing/tests/nine-router-runtime.service.test.ts`

**Step 1: Write failing tests**

Cover these observable outcomes using an injected HTTP health checker:

```ts
test('reports ready only for a valid official health response', async () => {
  const service = createNineRouterSidecarService({
    baseUrl: 'http://9router:20128',
    health: async () => ({ ok: true, version: '0.5.45' }),
  });
  assert.deepEqual(await service.refresh(), {
    state: 'ready',
    origin: 'http://9router:20128',
    version: '0.5.45',
    lastError: null,
  });
});

test('reports unavailable without spawning or killing a process', async () => {
  // Reject the health call and assert a sanitized retryable status.
});
```

Also prove only `http:` or `https:` configured origins without credentials, query, or fragment are accepted and that no runtime `restart` operation is advertised.

**Step 2: Run RED**

Run: `npm test -- server/modules/routing/tests/nine-router-sidecar.service.test.ts`
Expected: FAIL because the sidecar service does not exist.

**Step 3: Implement the minimal adapter**

Implement a service with `refresh()` and `getStatus()` only. Read `NINE_ROUTER_BASE_URL`; do not import `child_process`, allocate ports, create data directories, or own timers for crash restart. Keep HTTP I/O injected for tests and reuse the existing bounded request and response-validation conventions.

Update routing composition to construct routing clients from the configured sidecar origin and stored management/data-plane credentials.

**Step 4: Run GREEN and relevant regressions**

Run:

```bash
npm test -- server/modules/routing/tests/nine-router-sidecar.service.test.ts server/modules/routing/tests/routing.module.test.ts server/modules/routing/tests/server-lifecycle-composition.test.ts
npm run typecheck
```

Expected: PASS. Server lifecycle tests must prove CloudCLI shutdown does not signal or stop 9router.

**Step 5: Commit**

```bash
git add server/modules/routing
 git commit -m "refactor(routing): use external 9router sidecar"
```

### Task 2: Add Compose-owned official 9router service and persistence

**Files:**
- Create: `docker/9router/Dockerfile`
- Create: `compose.yml`
- Create: `docker/9router/entrypoint.sh` only if the official package has no direct noninteractive command
- Modify: `.dockerignore`
- Modify: relevant environment example or deployment documentation discovered in the repository
- Test: `server/modules/routing/tests/nine-router-package.test.ts`

**Step 1: Write/adjust failing package tests**

Assert the Dockerfile pins `9router@0.5.45`, binds on the container network, persists `/data`, and does not copy or reimplement upstream source.

**Step 2: Run RED**

Run: `npm test -- server/modules/routing/tests/nine-router-package.test.ts`
Expected: FAIL because the sidecar Dockerfile and Compose service do not exist.

**Step 3: Add minimal container definitions**

Build a small Node runtime image that installs exactly `9router@0.5.45` and invokes its official server entrypoint. Define `cloudcli` and `9router` services on a private network. Give 9router a named volume and `expose`, not `ports`. Supply CloudCLI `NINE_ROUTER_BASE_URL=http://9router:20128`; pass secrets through environment/config without baking them into either image. Add a healthcheck against the official health endpoint.

**Step 4: Validate Compose**

Run:

```bash
docker compose config
npm test -- server/modules/routing/tests/nine-router-package.test.ts
```

Expected: valid configuration and passing package tests.

**Step 5: Commit**

```bash
git add compose.yml docker/9router .dockerignore server/modules/routing/tests/nine-router-package.test.ts
 git commit -m "feat(docker): run official 9router as sidecar"
```

### Task 3: Simplify the product REST facade and remove process/usage semantics

**Files:**
- Modify: `shared/routing.ts`
- Modify: `server/shared/interfaces.ts`
- Modify: `server/modules/routing/routing.routes.ts`
- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/routing/nine-router-client.ts`
- Modify: `server/modules/routing/routing-runtime.service.ts`
- Modify: `server/modules/routing/tests/routing.routes.test.ts`
- Modify: `server/modules/routing/tests/routing.service.test.ts`
- Modify: `server/modules/routing/tests/nine-router-client.test.ts`
- Delete if no remaining consumer: `server/modules/routing/routing-usage-monitor.ts`
- Delete if no remaining consumer: `server/modules/routing/tests/routing-usage-monitor.test.ts`

**Step 1: Write failing contract tests**

Prove aggregate/model/provider/OAuth endpoints still proxy the official REST API, while restart, usage estimate, usage alerts, and per-agent source binding operations are absent or explicitly unsupported. Prove unavailable sidecar errors are retryable and do not affect provider-native APIs.

**Step 2: Run RED**

Run:

```bash
npm test -- server/modules/routing/tests/routing.routes.test.ts server/modules/routing/tests/routing.service.test.ts server/modules/routing/tests/nine-router-client.test.ts
```

Expected: FAIL on obsolete endpoint/contract expectations.

**Step 3: Implement contract reduction**

Remove UI-facing usage and binding fields from routing aggregate types and route registration. Keep stored legacy records untouched. Retain validated account, provider-node, route, model, OAuth, and device-flow methods. Thin routes must only parse input, call services, and format responses.

**Step 4: Run GREEN**

Run the tests from Step 2 plus `npm run typecheck`.

**Step 5: Commit**

```bash
git add shared/routing.ts server/shared server/modules/routing
 git commit -m "refactor(routing): expose sidecar REST capabilities only"
```

### Task 4: Add a discriminated unified model catalog

**Files:**
- Modify: `server/modules/providers/services/provider-models.service.ts`
- Modify: `server/modules/providers/tests/provider-models.service.test.ts`
- Modify: provider model route file discovered through the providers module barrel
- Modify: `src/components/chat/hooks/useChatProviderState.ts`
- Add or modify: chat provider-state tests adjacent to the hook
- Modify: shared provider-model response types used by both layers

**Step 1: Write failing backend and hook tests**

Prove:

```ts
assert.deepEqual(models, [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet', source: 'native' },
  { value: '9router:anthropic/claude-opus', label: 'Anthropic · Claude Opus', source: '9router' },
]);
```

The exact fields may follow the existing `ProviderModelsDefinition`, but the discriminant must be explicit and 9router values collision-free. If 9router is unavailable, native entries remain unchanged.

**Step 2: Run RED**

Run:

```bash
npm test -- server/modules/providers/tests/provider-models.service.test.ts <new-hook-test-path>
```

Expected: FAIL because the catalog contains native entries only.

**Step 3: Implement minimal catalog merge**

Fetch sanitized 9router models through the routing module barrel. Append them only when the sidecar is ready. Do not infer pricing or capabilities absent from official model data. Preserve existing native defaults and effort options.

**Step 4: Run GREEN**

Run relevant provider and chat tests plus typecheck.

**Step 5: Commit**

```bash
git add server/modules/providers src/components/chat shared
 git commit -m "feat(chat): merge 9router models into model catalog"
```

### Task 5: Route selected 9router models through the official REST data plane

**Files:**
- Create: `server/modules/routing/nine-router-inference.service.ts`
- Create: `server/modules/routing/tests/nine-router-inference.service.test.ts`
- Modify: `server/modules/routing/index.ts`
- Modify: `server/modules/providers/services/provider-session-routing.service.ts`
- Modify: provider runtime service(s) that currently dispatch Claude/Codex/OpenCode messages
- Modify: `server/modules/providers/tests/provider-routing-session.test.ts`
- Modify: `server/modules/providers/tests/runtime-routing-options.test.ts`
- Modify: WebSocket or agent request boundary tests that assert outbound execution

**Step 1: Write failing dispatch tests**

Prove native model selections invoke the existing native agent unchanged. Prove `9router:<id>` strips only the namespace and sends the official model ID to 9router with the data-plane key. Prove streaming chunks and terminal errors are forwarded safely, abort signals cancel upstream fetches, and an unavailable model yields a structured error before send.

**Step 2: Run RED**

Run:

```bash
npm test -- server/modules/routing/tests/nine-router-inference.service.test.ts server/modules/providers/tests/provider-routing-session.test.ts server/modules/providers/tests/runtime-routing-options.test.ts
```

Expected: FAIL because no inference adapter exists.

**Step 3: Implement the smallest REST adapter and dispatch branch**

Use official 9router OpenAI/Anthropic-compatible REST semantics already provided by `0.5.45`; do not reproduce routing logic. Stream the upstream response rather than buffering. Validate status/content type and sanitize upstream failures. Cross-module imports must use `server/modules/routing/index.ts`.

**Step 4: Run GREEN and integration tests**

Run Step 2 tests and provider runtime tests. Confirm native behavior remains byte-for-byte compatible at the request boundary where feasible.

**Step 5: Commit**

```bash
git add server/modules/routing server/modules/providers
 git commit -m "feat(routing): dispatch 9router models over REST"
```

### Task 6: Remove model-source and usage-estimate UI

**Files:**
- Modify carefully, preserving pre-existing user edits: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts`
- Delete: `src/components/settings/view/tabs/nine-router-settings/ModelSourceSection.tsx`
- Delete: usage section component(s) identified by import from `NineRouterSettingsTab.tsx`
- Modify: relevant English and translated settings resource files

**Step 1: Write failing UI tests**

Assert rendered settings contain provider connection and model information but no model-source controls, usage estimate, estimated cost, usage alerts, or automatic usage requests. Assert the existing native-agent availability message remains accurate.

**Step 2: Run RED**

Run:

```bash
npm test -- src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts
```

Expected: FAIL because obsolete sections and requests still exist.

**Step 3: Remove obsolete UI and controller paths**

Delete source binding and usage APIs from the frontend client/controller. Stop eager usage loading. Keep provider catalog, OAuth/device/custom-provider dialogs, accounts, routes if required by 9router itself, and model display.

Before editing `NineRouterSettingsTab.tsx`, capture its existing diff and merge around the user's nine-line removal. Stage only intentional final hunks.

**Step 4: Run GREEN and typecheck**

Run Step 2 tests and `npm run typecheck`.

**Step 5: Commit**

```bash
git add src/components/settings
 git commit -m "refactor(settings): focus 9router UI on providers and models"
```

### Task 7: Persist and restore discriminated session models

**Files:**
- Modify: active-model route/service in `server/modules/providers/`
- Modify: `server/modules/providers/tests/provider-routing-session.test.ts`
- Modify: `src/components/chat/hooks/useChatProviderState.ts`
- Modify: `src/components/chat/view/ChatInterface.tsx`
- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx` only if option rendering needs source grouping
- Add/modify adjacent React tests

**Step 1: Write failing persistence tests**

Prove `9router:<model-id>` survives active-model save/load and reopening the session. Prove a disappeared 9router model remains visible as unavailable and cannot be sent until replaced. Prove native stored model behavior is unchanged.

**Step 2: Run RED**

Run targeted provider session and chat component tests.

**Step 3: Implement persistence and unavailable rendering**

Treat the namespaced model as an opaque persisted value at storage boundaries. Resolve its availability only against the current merged catalog. Group display labels by native agent versus upstream provider without adding a source selector.

**Step 4: Run GREEN**

Run targeted tests and typecheck.

**Step 5: Commit**

```bash
git add server/modules/providers src/components/chat
 git commit -m "feat(chat): persist 9router model selections"
```

### Task 8: Real Compose, OAuth, inference, resilience, and full regression verification

**Files:**
- Modify tests or Compose files only when a concrete verification failure requires a fix
- Update: `docs/plans/2026-08-05-9router-sidecar-rest-design.md` only if implementation forced an approved design correction

**Step 1: Build and start the stack**

Run:

```bash
docker compose build --no-cache
 docker compose up -d
 docker compose ps
```

Expected: CloudCLI and 9router healthy; 9router has no host-published port.

**Step 2: Verify same-origin management and persistence**

Through authenticated CloudCLI endpoints, verify health/version `0.5.45`, provider catalog, a real supported OAuth or device flow, configured accounts, and discovered models. Restart only the 9router Compose service and confirm configuration persists.

**Step 3: Verify execution paths**

Send one native-agent request while 9router is healthy. Send one real 9router-backed inference request after selecting its provider model. Stop the 9router sidecar and prove native sending still works while the 9router entry reports unavailable. Start it again and prove recovery.

**Step 4: Run full quality gates**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Build and inspect both existing Claude and Codex product images. Expected: all commands exit 0, except documented pre-existing non-fatal warnings.

**Step 5: Review scope and commit any verification fixes**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~8..HEAD
```

Confirm `package.json`, `package-lock.json`, `findings.md`, `progress.md`, `task_plan.md`, and unrelated user work are not included unless explicitly required and separately justified.

Commit only concrete fixes with focused messages. Do not squash the prior incremental commits.
