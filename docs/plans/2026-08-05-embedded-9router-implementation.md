# Embedded 9Router Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle the complete official 9Router runtime in CloudCLI and make provider, route, usage, and agent routing management work with zero user-supplied 9Router configuration.

**Architecture:** CloudCLI supervises the pinned `9router@0.5.45` standalone Next.js server on loopback and calls its allowlisted management APIs from the existing routing module. Installation secrets and runtime state are generated internally, while the browser uses only authenticated same-origin CloudCLI APIs. The existing native agent paths remain unchanged and the embedded child owns routing, fallback, translation, quota, and upstream connection behavior.

**Tech Stack:** TypeScript, Node.js child processes and HTTP, Express, SQLite/better-sqlite3, React, 9Router standalone Next.js server, Node test runner with `tsx`.

**Design reference:** `docs/plans/2026-08-05-embedded-9router-design.md`

---

## Execution rules

- Apply `.agents/skills/backend-module-standards/SKILL.md` to every `server/` change.
- Use TDD for every behavioral step: failing test, observed failure, minimal implementation, passing test, then commit.
- Do not stage the user's unrelated `package.json`, `package-lock.json`, `findings.md`, `progress.md`, or `task_plan.md` changes unless a task explicitly changes those package files.
- Keep cross-module imports through `index.ts` barrels.
- Never log child environment values, management cookies, API keys, OAuth codes, state, or PKCE verifiers.
- Keep the official runtime listener loopback-only. Do not expose or iframe its dashboard.

### Task 1: Pin and verify the official runtime artifact

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `server/modules/routing/tests/nine-router-package.test.ts`

**Step 1: Write the failing package-contract test**

Create a test that resolves `9router/package.json`, asserts exact version `0.5.45`, resolves the package root, and verifies these files exist:

```ts
const packageJsonPath = require.resolve('9router/package.json');
const packageRoot = path.dirname(packageJsonPath);
assert.equal(JSON.parse(readFileSync(packageJsonPath, 'utf8')).version, '0.5.45');
assert.equal(existsSync(path.join(packageRoot, 'app', 'custom-server.js')), true);
assert.equal(existsSync(path.join(packageRoot, 'app', 'server.js')), true);
```

**Step 2: Run the test and observe RED**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/nine-router-package.test.ts
```

Expected: FAIL because `9router` is not installed.

**Step 3: Add the exact production dependency**

Run:

```bash
npm install --save-exact 9router@0.5.45
```

Review the lockfile. Confirm the package license is MIT and the dependency is not placed in `devDependencies`.

**Step 4: Run the contract test**

Expected: PASS. Also run `npm ls 9router` and confirm exactly `9router@0.5.45`.

**Step 5: Commit**

```bash
git add package.json package-lock.json server/modules/routing/tests/nine-router-package.test.ts
git commit -m "build(routing): bundle 9router runtime"
```

### Task 2: Generate stable internal runtime secrets

**Files:**
- Modify: `server/modules/database/repositories/app-config.ts`
- Test: `server/modules/database/tests/app-config.test.ts` (create if absent)

**Step 1: Write failing repository tests**

Test that `getOrCreateSecret(key, bytes)`:

- returns a hex string of `bytes * 2` characters;
- returns the same value on the second call;
- produces different values for different keys;
- rejects an empty key or byte count outside a conservative range.

Use a temporary database and the existing database test setup pattern.

**Step 2: Run the narrow test and observe RED**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/app-config.test.ts
```

Expected: FAIL because `getOrCreateSecret` does not exist.

**Step 3: Implement the generic secret primitive**

Add to `appConfigDb`:

```ts
getOrCreateSecret(key: string, bytes = 32): string {
  if (!key.trim() || !Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new Error('Invalid application secret configuration');
  }
  let secret = appConfigDb.get(key);
  if (!secret) {
    secret = crypto.randomBytes(bytes).toString('hex');
    appConfigDb.set(key, secret);
  }
  return secret;
}
```

Refactor `getOrCreateJwtSecret()` to delegate to this method without changing its 64-byte behavior.

**Step 4: Run tests and typecheck**

Run the new test and the auth middleware tests. Expected: PASS.

**Step 5: Commit**

```bash
git add server/modules/database/repositories/app-config.ts server/modules/database/tests/app-config.test.ts
git commit -m "feat(database): generate installation secrets"
```

### Task 3: Build the embedded runtime supervisor

**Files:**
- Create: `server/modules/routing/nine-router-runtime.service.ts`
- Create: `server/modules/routing/tests/nine-router-runtime.service.test.ts`
- Modify: `server/modules/routing/index.ts`

**Step 1: Define behavior with failing tests**

Use injected process, filesystem, clock, port, and health adapters. Cover:

- package entry-point resolution;
- `HOSTNAME=127.0.0.1`, `PORT=20128`, `DATA_DIR`, `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `BASE_URL`, and `NEXT_PUBLIC_BASE_URL` child environment;
- environment allowlisting rather than blindly copying secret-bearing parent variables;
- readiness transition from `starting` to `ready` only after `/api/health` succeeds;
- startup timeout to `unavailable`;
- occupied port returns `ROUTING_PORT_OCCUPIED` and never kills the owner;
- unexpected exit restarts with capped backoff;
- repeated crashes open a circuit breaker;
- `stop()` sends `SIGTERM`, waits, then escalates after the deadline;
- stderr tail is bounded and redacted.

Example public contract:

```ts
type NineRouterRuntimeStatus = {
  state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'unavailable';
  origin: string | null;
  version: string | null;
  lastError: RoutingSafeError | null;
};

export function createNineRouterRuntimeService(dependencies: NineRouterRuntimeDependencies) {
  return {
    start(): Promise<void>,
    stop(): Promise<void>,
    restart(): Promise<void>,
    getStatus(): NineRouterRuntimeStatus,
    getInternalCredentials(): RoutingClientCredentials,
  };
}
```

Keep dependency and status types local unless a second file genuinely needs them. Export only the service factory and singleton lifecycle methods required by consumers, each with consumer comments.

**Step 2: Run RED tests**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/nine-router-runtime.service.test.ts
```

Expected: FAIL because the service is absent.

**Step 3: Implement minimal lifecycle logic**

Use `spawn(process.execPath, [customServerPath])`, `detached: false`, ignored stdin, and piped stderr. Do not invoke `9router/cli.js`.

Resolve the data directory as:

```ts
path.join(path.dirname(getDatabasePath()), '9router')
```

Create it with owner-only permissions where supported. Never delete it during stop or restart.

**Step 4: Make tests green and refactor**

Run the narrow tests after each lifecycle behavior. Confirm no timer or child-process handles leak after every test.

**Step 5: Commit**

```bash
git add server/modules/routing/nine-router-runtime.service.ts server/modules/routing/tests/nine-router-runtime.service.test.ts server/modules/routing/index.ts
git commit -m "feat(routing): supervise embedded 9router"
```

### Task 4: Wire startup, shutdown, and health into the composition root

**Files:**
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/modules/routing/index.ts`
- Modify: `server/index.ts`
- Modify: `server/modules/routing/tests/routing-runtime.service.test.ts`

**Step 1: Add failing lifecycle composition tests**

Prove that:

- embedded 9Router starts only after `initializeDatabase()`;
- usage monitoring starts only when the runtime is ready;
- CloudCLI startup continues when embedded 9Router is unavailable;
- shutdown stops usage monitoring and awaits the embedded child before exit.

Extract only the smallest testable startup orchestration needed. Do not move unrelated server setup.

**Step 2: Observe RED**

Run the routing runtime and relevant server composition test. Expected: lifecycle assertions fail.

**Step 3: Wire the singleton**

In `routing.module.ts`, build secrets with `appConfigDb.getOrCreateSecret(...)`, pass `getDatabasePath()`, and construct the supervisor. Export documented `startEmbeddedNineRouter`, `stopEmbeddedNineRouter`, `restartEmbeddedNineRouter`, and status access through `routing/index.ts`.

In `server/index.ts`:

```ts
await initializeDatabase();
await startEmbeddedNineRouter(); // catches internally and records unavailable state
startRoutingUsageMonitor();
```

Remove `tryAutoConnect` startup usage. Await `stopEmbeddedNineRouter()` in `shutdownRuntimeServices()`.

**Step 4: Run lifecycle tests**

Expected: PASS with no unhandled rejection when the child cannot start.

**Step 5: Commit**

```bash
git add server/index.ts server/modules/routing/routing.module.ts server/modules/routing/index.ts server/modules/routing/tests/routing-runtime.service.test.ts
git commit -m "feat(routing): own embedded router lifecycle"
```

### Task 5: Replace external connection storage with embedded credentials

**Files:**
- Modify: `shared/routing.ts`
- Modify: `server/shared/interfaces.ts`
- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/routing/routing-runtime.service.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/modules/routing/routing.routes.ts`
- Modify: `server/modules/routing/tests/routing.service.test.ts`
- Modify: `server/modules/routing/tests/routing-runtime.service.test.ts`
- Modify: `server/modules/routing/tests/routing.routes.test.ts`

**Step 1: Change the contract in failing tests**

Replace the user-facing connection DTO with an embedded runtime DTO:

```ts
export type RoutingRuntimeView = {
  mode: 'embedded';
  status: 'starting' | 'ready' | 'degraded' | 'unavailable';
  version: string | null;
  lastCheckedAt: string | null;
  lastError: RoutingSafeError | null;
  capabilities: RoutingCapabilities;
};
```

`RoutingSettingsView` contains `runtime`, not `connection`. Delete `UpdateRoutingConnectionInput` and `ValidateRoutingConnectionInput` once all consumers move.

Tests must prove `getSettings(userId)` reports embedded status without a `routing_connections` row or secure store, and account/route operations obtain a client from supervisor credentials.

**Step 2: Observe RED**

Run the three routing test files. Expected: compile/test failures against the old connection contract.

**Step 3: Refactor the services**

Inject into both routing services:

```ts
runtime: {
  getStatus(): NineRouterRuntimeStatus;
  getInternalCredentials(): RoutingClientCredentials;
}
```

Delete `openCredentials`, `resolveSecret`, external target validation, connect, validate-connection, edit-connection, and disconnect workflows. Keep repository-backed per-user bindings and alerts.

When runtime state is not ready, management operations throw a typed safe `ROUTING_RUNTIME_UNAVAILABLE`. Do not silently fall back a run explicitly bound to 9Router.

Remove the connection mutation routes. Add an authenticated `POST /api/routing/runtime/restart` route that calls the service restart workflow.

**Step 4: Run tests and typecheck**

Expected: all routing service/route/runtime tests PASS.

**Step 5: Commit**

```bash
git add shared/routing.ts server/shared/interfaces.ts server/modules/routing/routing.service.ts server/modules/routing/routing-runtime.service.ts server/modules/routing/routing.module.ts server/modules/routing/routing.routes.ts server/modules/routing/tests
git commit -m "refactor(routing): use embedded router credentials"
```

### Task 6: Remove the connection gate from Settings

**Files:**
- Delete: `src/components/settings/view/tabs/nine-router-settings/ConnectionSection.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingState.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingState.test.ts`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`
- Modify: `src/i18n/locales/zh-TW/settings.json`

**Step 1: Write failing UI tests**

Assert first render:

- contains built-in runtime status;
- contains no base URL, admin password, data-plane key, connect, disconnect, or secure-storage copy;
- enables account/route sections when status is ready;
- shows a retry/restart action when unavailable;
- preserves native-login messaging and existing detail-loading gates.

**Step 2: Observe RED**

Run the three settings test files. Expected: old connection UI assertions fail.

**Step 3: Update parser, state, hook, and view**

Delete `connectionDraft`, connect/validate/disconnect mutations, and secure-storage branching. Parse the new `runtime` DTO strictly. Add only `restartRuntime()` to the API client and hook.

Do not weaken the existing explicit empty/loading/error states for accounts, routes, or usage.

**Step 4: Run UI tests**

Expected: PASS. Run `npm run lint` for the touched UI files.

**Step 5: Commit**

```bash
git add src/components/settings/view/tabs/nine-router-settings src/i18n/locales
git commit -m "feat(settings): make 9router configuration zero-touch"
```

### Task 7: Add full provider and OAuth management contracts

**Files:**
- Modify: `shared/routing.ts`
- Modify: `server/shared/interfaces.ts`
- Modify: `server/modules/routing/nine-router-http.ts`
- Modify: `server/modules/routing/nine-router-client.ts`
- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/routing/routing.routes.ts`
- Modify: `server/modules/routing/tests/nine-router-http.test.ts`
- Modify: `server/modules/routing/tests/nine-router-client.test.ts`
- Modify: `server/modules/routing/tests/routing.service.test.ts`
- Modify: `server/modules/routing/tests/routing.routes.test.ts`

**Step 1: Add failing adapter tests for allowlisted operations**

Cover these official v0.5.45 operations:

```text
GET    /api/providers/:id
GET    /api/providers/:id/models
GET    /api/oauth/:provider/authorize
POST   /api/oauth/:provider/exchange
GET    /api/oauth/:provider/device-code
POST   /api/oauth/:provider/poll
GET    /api/provider-nodes
POST   /api/provider-nodes
POST   /api/provider-nodes/validate
PUT    /api/provider-nodes/:id
DELETE /api/provider-nodes/:id
```

Test encoded IDs, query encoding, body bounds, response validation, auth retry rules, and redacted failures. Mutation requests must never be retried after an ambiguous response.

**Step 2: Observe RED**

Run `nine-router-http.test.ts` and `nine-router-client.test.ts`. Expected: missing operations.

**Step 3: Add shared DTOs and client methods**

Add detailed documented shared types for provider connection method, device-code challenge, OAuth start result, OAuth polling state, and custom provider node safe views. Extend `IRoutingNineRouterClient` with only methods consumed by `routing.service.ts`.

Do not expose access tokens, refresh tokens, code verifier, internal redirect credentials, cookies, or raw upstream errors in any view type.

**Step 4: Add thin authenticated routes**

Routes validate transport inputs, call one service method, and format the result. Keep OAuth state/PKCE orchestration in the service.

**Step 5: Run the four backend test files**

Expected: PASS.

**Step 6: Commit**

```bash
git add shared/routing.ts server/shared/interfaces.ts server/modules/routing
git commit -m "feat(routing): expose embedded provider connection APIs"
```

### Task 8: Implement secure OAuth state and topology handling

**Files:**
- Create: `server/modules/routing/routing-oauth.service.ts`
- Create: `server/modules/routing/tests/routing-oauth.service.test.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/routing/routing.routes.ts`

**Step 1: Write failing security tests**

Test:

- random state is user-bound, provider-bound, expires, and is consumed once;
- wrong user/provider/state is rejected before exchange;
- PKCE verifier never appears in browser DTOs or logs;
- device-code poll enforces bounded intervals and cancellation;
- remote deployments prefer device code;
- fixed-localhost-only flows return `ROUTING_OAUTH_TOPOLOGY_UNSUPPORTED` when the server is remote;
- callback input has strict maximum lengths.

**Step 2: Observe RED**

Run the new test. Expected: service absent.

**Step 3: Implement in-memory short-lived transactions**

Use a `Map` keyed by a cryptographically random state, with a maximum entry count, TTL cleanup, user/provider binding, and one-time removal before exchange. OAuth transactions are transient and need not survive a server restart.

For configurable authorization-code flows, construct a CloudCLI callback URL from the trusted server origin configuration, never from arbitrary forwarded headers. Prefer device-code flow for remote Docker.

**Step 4: Run tests**

Expected: PASS, including concurrent and expiry cases.

**Step 5: Commit**

```bash
git add server/modules/routing/routing-oauth.service.ts server/modules/routing/tests/routing-oauth.service.test.ts server/modules/routing/routing.module.ts server/modules/routing/routing.service.ts server/modules/routing/routing.routes.ts
git commit -m "feat(routing): secure embedded oauth workflows"
```

### Task 9: Add the native provider connection UI

**Files:**
- Create: `src/components/settings/view/tabs/nine-router-settings/ProviderCatalog.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/OAuthDeviceFlow.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/CustomProviderEditor.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/UpstreamsRoutesSection.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingApi.ts`
- Test: adjacent `*.test.tsx` and `routingApi.test.ts`
- Modify: all three settings locale files

**Step 1: Write failing UI behavior tests**

Cover:

- provider selection shows only connection methods supported by that provider/runtime profile;
- API keys remain write-only and clear after success;
- device code shows verification URL, user code, expiry, pending state, cancellation, and success;
- authorization-code flow opens only the server-returned HTTPS/loopback allowlisted URL;
- popup closure or OAuth failure returns to the same Settings page;
- custom provider validation runs before save;
- unsupported remote callback topology explains why and offers device flow when available.

**Step 2: Observe RED**

Run the new component tests. Expected: components/methods absent.

**Step 3: Implement the smallest native UI**

Reuse the existing Settings components and spacing. Do not embed the 9Router dashboard or create nested routing pages. Provider connection controls expand inline or in the existing dialog pattern.

**Step 4: Run UI tests and real browser verification**

Run tests, then verify in a browser at desktop and mobile widths. Inspect console and network requests: all management calls must target CloudCLI `/api/routing/...` only.

**Step 5: Commit**

```bash
git add src/components/settings/view/tabs/nine-router-settings src/i18n/locales
git commit -m "feat(settings): manage embedded 9router providers"
```

### Task 10: Retire external provisioning and preserve rollback data

**Files:**
- Delete: `server/modules/routing/routing-auto-connect.ts`
- Delete: its tests if present
- Modify: `server/modules/routing/routing-secret-store.ts` or delete after confirming no consumers
- Modify: `server/modules/routing/index.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `.env.example`
- Modify: `docs/plans/2026-08-04-9router-api-only-design.md` with a superseded notice
- Modify: `docs/plans/2026-08-04-9router-api-only-implementation.md` with a superseded notice
- Test: `server/modules/database/tests/routing.db.integration.test.ts`

**Step 1: Add migration/compatibility tests**

Prove old `routing_connections` rows remain unread and untouched, native bindings remain unchanged, and external route IDs become an explicit unresolved state rather than silently mapping to another embedded route.

**Step 2: Remove active external configuration paths**

Remove these variables and documentation:

```text
ROUTING_SECRET_KEY
ROUTING_SECRET_KEY_FILE
ROUTING_BASE_URL
ROUTING_ADMIN_PASSWORD
ROUTING_DATA_PLANE_KEY
ROUTING_ALLOWED_HOSTS
ROUTING_ALLOWED_CIDRS
ROUTING_ALLOW_LOOPBACK_HTTP
```

Delete target-policy and secret-store code only if no non-obsolete consumer remains. Do not drop the database table in this change; retain dormant rollback data for one release.

**Step 3: Run routing and database tests**

Expected: PASS and no source reference to external provisioning variables outside superseded historical text.

**Step 4: Commit**

```bash
git add .env.example server/modules/routing server/modules/database/tests docs/plans
git commit -m "refactor(routing): retire external 9router provisioning"
```

### Task 11: End-to-end Docker and agent validation

**Files:**
- Modify: Docker files only if the production image omits the 9Router package/runtime files or persistent directory
- Create: `server/modules/routing/tests/embedded-nine-router.integration.test.ts`
- Modify: deployment documentation with zero-config behavior

**Step 1: Add an opt-in real-runtime integration test**

The test should:

1. Create a temporary `DATABASE_PATH` and 9Router data directory.
2. Start the packaged child on loopback.
3. Wait for health/version.
4. Authenticate with generated internal credentials.
5. Call models/providers/combos APIs.
6. Stop the child and assert no process remains.

Gate it behind `RUN_EMBEDDED_9ROUTER_TESTS=true` so normal unit tests remain fast and deterministic.

**Step 2: Run the real-runtime test**

```bash
RUN_EMBEDDED_9ROUTER_TESTS=true npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/embedded-nine-router.integration.test.ts
```

Expected: PASS.

**Step 3: Build and run the Docker image with zero routing environment variables**

Verify:

- CloudCLI and 9Router become ready;
- data persists across container restart;
- only the CloudCLI port is published;
- port 20128 is unreachable from the host/network;
- provider/route Settings requests are same-origin;
- no internal secret appears in logs or API responses.

**Step 4: Validate agent routing**

With test provider credentials, create a combo and run one request through each supported runtime: Claude, Codex, and OpenCode. Confirm native runs remain unchanged before and after routed runs.

**Step 5: Run full quality gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all pass. If the known `agent.routes.test.ts` failure persists on the clean baseline, document it with clean-tree reproduction rather than attributing it to this work.

**Step 6: Request code review and commit final integration changes**

Use the code-review skill. Resolve all high-confidence correctness, security, lifecycle, and secret-handling findings, rerun affected checks, then commit:

```bash
git add <only embedded-routing files>
git commit -m "test(routing): validate embedded 9router end to end"
```

## Completion criteria

- A clean install and Docker deployment need no routing environment variables.
- No endpoint, admin password, data-plane key, or routing storage key appears in Settings.
- The official 9Router child is bundled, loopback-only, supervised, persistent, version-pinned, and stopped cleanly.
- API-key, device-code, supported authorization-code, custom provider, combo, model, usage, and routed-agent workflows stay inside CloudCLI.
- Native coding-agent identities and credentials remain untouched.
- Browser management traffic is authenticated and same-origin.
- Explicitly routed sessions fail clearly when the embedded runtime is unavailable; they never silently use another paid path.
- Tests, typecheck, lint, build, real-runtime smoke test, and Docker validation pass.
