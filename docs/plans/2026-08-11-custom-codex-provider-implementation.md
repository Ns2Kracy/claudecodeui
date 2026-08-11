# Custom Codex Provider Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an authenticated “Apply to Codex” action that persists the embedded 9Router endpoint and data-plane token as Codex provider `Custom` without changing Codex’s active provider or model.

**Architecture:** A dedicated Codex config writer in the provider module owns TOML parsing and atomic filesystem replacement. The routing service obtains server-only sidecar credentials and invokes that writer through an injected narrow port; a protected routing mutation endpoint exposes only safe success metadata. The existing settings controller and view call the endpoint and display localized pending/success/error states.

**Tech Stack:** TypeScript, Express, React, `@iarna/toml`, Node filesystem APIs, Node test runner.

---

### Task 1: Implement the Codex Custom provider config writer

**Files:**

- Create: `server/modules/providers/list/codex/codex-custom-provider-config.ts`
- Create: `server/modules/providers/list/codex/codex-custom-provider-config.test.ts`

**Step 1: Write failing filesystem tests**

Use a temporary home/config path injected into the writer. Cover:

```ts
await applyCustomCodexProvider({
  configPath,
  baseUrl: 'http://127.0.0.1:20128/api/v1',
  apiKey: 'router-key',
});
```

Assert parsed TOML contains:

```ts
assert.deepEqual(parsed.model_providers.Custom, {
  name: 'Custom',
  base_url: 'http://127.0.0.1:20128/api/v1',
  wire_api: 'responses',
  experimental_bearer_token: 'router-key',
});
```

Add cases proving existing `model`, `model_provider`, other providers, and unknown fields under `Custom` survive; managed fields update on a second call; invalid TOML rejects and original bytes remain unchanged.

**Step 2: Run tests and confirm RED**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/list/codex/codex-custom-provider-config.test.ts
```

Expected: FAIL because the module/export does not exist.

**Step 3: Implement the minimum writer**

Export a narrow input/result contract and `applyCustomCodexProvider`. Read missing files as `{}`, parse existing files with `TOML.parse`, merge only managed fields into `model_providers.Custom`, serialize with `TOML.stringify`, create the directory, write a mode-`0o600` sibling temporary file, then `rename` it over the target. On parse failure throw a typed `AppError` such as `CODEX_CONFIG_INVALID` with status 409; on filesystem failure clean up the temporary file and throw `CODEX_CONFIG_WRITE_FAILED` without including secrets in messages.

Keep provider identifier and display name exactly `Custom`. Do not set top-level `model_provider` or `model`.

**Step 4: Run targeted tests and confirm GREEN**

Run the Task 1 command. Expected: all writer tests PASS.

**Step 5: Commit**

```bash
git add server/modules/providers/list/codex/codex-custom-provider-config.ts server/modules/providers/list/codex/codex-custom-provider-config.test.ts
git commit -m "feat(codex): persist Custom routing provider"
```

### Task 2: Add the protected routing application service and endpoint

**Files:**

- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/modules/routing/routing.routes.ts`
- Modify: `server/modules/routing/tests/routing.service.test.ts`
- Modify: `server/modules/routing/tests/routing.routes.test.ts`

**Step 1: Write failing service tests**

Inject a `codexConfig` port with:

```ts
applyCustomProvider(input: { baseUrl: string; apiKey: string }): Promise<{ provider: 'Custom' }>;
```

Assert `applyToCodex(userId)`:

- refuses when sidecar status is not `ready`;
- passes `${origin}/api/v1` and the internal `dataPlaneKey` to the port when ready;
- returns only `{ provider: 'Custom' }` and never credentials.

**Step 2: Run the service test and confirm RED**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing.service.test.ts
```

Expected: FAIL because `applyToCodex` and its dependency do not exist.

**Step 3: Implement service composition**

Add the narrow port to `createRoutingService` dependencies. Reuse the existing runtime-ready/credential path rather than duplicating sidecar checks. Compose the production adapter in `routing.module.ts` using Task 1’s writer and the real `~/.codex/config.toml` default path.

**Step 4: Write a failing route test**

Add `POST /codex/applications` (under `/api/routing` when mounted). Assert it calls `service.applyToCodex(authenticatedUserId)`, responds with the standard success envelope, is covered by the existing mutation guard/rate limiter, and emits no token.

**Step 5: Run route tests and confirm RED**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing.routes.test.ts
```

Expected: FAIL with missing endpoint/service method.

**Step 6: Implement the endpoint**

Register the route with the same mutation protection used by account/route writes:

```ts
router.post('/codex/applications', mutationGuard, asyncHandler(async (request, response) => {
  const result = await service.applyToCodex(userId(request));
  response.json(createApiSuccessResponse(result));
}));
```

Adapt exact middleware order to the current router factory.

**Step 7: Run backend tests and type checks**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/list/codex/codex-custom-provider-config.test.ts \
  server/modules/routing/tests/routing.service.test.ts \
  server/modules/routing/tests/routing.routes.test.ts
npm run build:server
```

Expected: all targeted tests PASS and server build exits 0.

**Step 8: Commit**

```bash
git add server/modules/routing/routing.service.ts server/modules/routing/routing.module.ts server/modules/routing/routing.routes.ts server/modules/routing/tests/routing.service.test.ts server/modules/routing/tests/routing.routes.test.ts
git commit -m "feat(routing): expose Codex provider sync"
```

### Task 3: Add the settings API client and controller mutation

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts`
- Modify or create test beside: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.test.ts`

**Step 1: Write a failing API client test**

Call `client.applyToCodex()` and assert one request:

```ts
assert.equal(request.url, '/api/routing/codex/applications');
assert.equal(request.init?.method, 'POST');
```

Parse and return only the safe `{ provider: 'Custom' }` response.

**Step 2: Run API test and confirm RED**

```bash
npx tsx --tsconfig server/tsconfig.json --test src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts
```

Expected: FAIL because `applyToCodex` is missing.

**Step 3: Implement API method and parser**

Add the smallest parser for `{ provider: 'Custom' }` and `applyToCodex()` using `jsonRequest('POST')`.

**Step 4: Add controller mutation coverage**

Add `applyToCodex` to the hook/controller through existing `runMutation` with key `codex:apply`. This operation does not mutate upstream 9Router data, so do not trigger an unnecessary settings refresh; if `runMutation` always refreshes, minimally extend it to support a no-refresh success path and test that behavior.

Track a small success state (for example `codexApplied`) cleared when a new apply starts and set only after success. Do not expose or retain the returned token because none exists.

**Step 5: Run targeted frontend logic tests**

Run the routing API test plus the hook/controller test selected in Step 4. Expected: PASS.

**Step 6: Commit**

```bash
git add src/components/settings/view/tabs/nine-router-settings/routingApi.ts src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.test.ts
git commit -m "feat(settings): call Codex provider sync API"
```

If the hook test is integrated into an existing file, stage that exact file instead of creating the proposed path.

### Task 4: Add the Apply to Codex UI and localization

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`
- Modify: other locale `settings.json` files only if this repository requires locale parity for new keys

**Step 1: Write failing view tests**

Extend `NineRouterSettingsTabViewProps` with `codexApplied` and `onApplyToCodex`. Assert:

- button label renders as “Apply to Codex” / “应用到 Codex” through translations;
- disabled when runtime is not ready;
- disabled and shows a spinner when `activeMutation === 'codex:apply'`;
- invokes callback once when ready;
- success feedback is visible when `codexApplied` is true;
- copy explicitly says current Codex provider/model remain unchanged.

**Step 2: Run component test and confirm RED**

```bash
npx tsx --tsconfig server/tsconfig.json --test src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx
```

Expected: FAIL because the action is absent.

**Step 3: Implement the minimum accessible UI**

Add one compact action section near the runtime/provider routing controls, not inside each route row. Use the shared `Button` and `Alert`; provide visible pending text, `aria`-compatible status feedback, and no confirmation dialog because the operation is idempotent and does not change defaults. Wire the container to `controller.applyToCodex()`.

Add English and Simplified Chinese keys for title, description, action, applying, and success. Follow current locale conventions; avoid exposing endpoint/token values in copy.

**Step 4: Run UI tests and client type/build checks**

```bash
npx tsx --tsconfig server/tsconfig.json --test src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx
npm run build:client
```

Expected: component tests PASS and client build exits 0.

**Step 5: Commit**

```bash
git add src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx src/i18n/locales/*/settings.json
git commit -m "feat(settings): add Apply to Codex action"
```

Only stage locale files actually changed.

### Task 5: End-to-end verification and review

**Files:**

- Modify only files required by discovered failures.

**Step 1: Mechanically confirm public registration**

```bash
rg "codex/applications|applyToCodex|model_providers.*Custom|experimental_bearer_token" server src
```

Expected: endpoint, service, writer, client, controller, and tests are all discoverable.

**Step 2: Run the focused behavioral suite**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/list/codex/codex-custom-provider-config.test.ts \
  server/modules/routing/tests/routing.service.test.ts \
  server/modules/routing/tests/routing.routes.test.ts \
  src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts \
  src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx
```

Expected: all tests PASS.

**Step 3: Run repository quality gates**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all commands exit 0. If unrelated pre-existing failures occur, capture exact evidence and do not broaden scope without approval.

**Step 4: Directly probe generated TOML with strict Codex config parsing**

Use a temporary `CODEX_HOME`, invoke the writer through its test/harness, then run the installed Codex CLI with `--strict-config --version` against that config. Verify the command succeeds and parsed TOML retains pre-existing `model_provider` and `model` values.

**Step 5: Security and diff review**

Inspect the final diff and confirm:

- no token appears in API response, UI state, logs, fixtures, snapshots, or committed config;
- only server code reads the real data-plane key;
- malformed TOML is never overwritten;
- top-level Codex defaults remain untouched;
- existing unrelated working-tree changes remain unstaged and unmodified.

Use `code-review-and-quality` and `verification-before-completion` before claiming completion.

**Step 6: Commit any verification-only fixes**

```bash
git add <only-files-fixed-during-verification>
git commit -m "fix: harden Custom Codex provider sync"
```

Skip this commit if no fixes were needed.
