# 9Router API-Only Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one secure `Settings > 9Router` page that preserves Claude, Codex, OpenCode, and Cursor as stable agents with native login, while allowing supported agents to use a user-managed 9router as an optional per-run model source.

**Architecture:** A new `server/modules/routing/` feature owns encrypted user-scoped connection metadata, a hardened typed 9router management client, provider and session source bindings, usage summaries, and advisory alerts. The existing provider registry remains unchanged. `providerRuntimeService` resolves a server-owned routing configuration and supplies it through `ProviderRuntimeContext` to Claude, Codex, and OpenCode adapters. The frontend adds one self-contained settings page and a dedicated hook/service, with no nested settings routes or tabs.

**Tech Stack:** TypeScript, Express, React 18, Node test runner, SQLite via `better-sqlite3`, Node `http`/`https`/`dns`/`net`/`crypto`, Electron `safeStorage`, i18next, Tailwind CSS.

**Required skills:** @backend-module-standards, @test-driven-development, @security-and-hardening, @incremental-implementation, @verification-before-completion, @code-review-and-quality.

**Design reference:** `docs/plans/2026-08-04-9router-api-only-design.md`

**External references:**
- 9router `0.5.45`, source commit `6fcd273`: <https://github.com/decolua/9router>
- AionUI separation model, reviewed at commit `322ecfd`: <https://github.com/iOfficeAI/AionUi>

---

## Implementation rules

1. Do not add `9router` to `LLMProvider` or `providerRegistry`.
2. Use `native` and `9router` as model-source values. Do not overload provider identity.
3. Never read, rewrite, migrate, or delete agent-owned OAuth or credential files.
4. Never expose admin passwords, data-plane API keys, cookies, or reversible masks to the browser.
5. Never create a generic upstream proxy. Browser routes map to an explicit allowlist of 9router operations.
6. Native mode must inject no router variables and must behave byte-for-byte as it does before this change.
7. Router failures must not silently fall back to native mode.
8. Cursor remains native-only until separately verified.
9. Keep every backend route thin. Put validation and orchestration in services, persistence in repositories, and remote calls in `NineRouterClient`.
10. Commit after each task. Stage only files named by that task.

---

### Task 1: Add shared routing contracts and safe DTOs

**Files:**
- Create: `shared/routing.ts`
- Create: `server/modules/routing/tests/routing-contracts.test.ts`

**Step 1: Write the failing contract test**

Create a test that verifies the public provider list, Cursor gating, and absence of secret-shaped fields:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROUTING_AGENTS,
  ROUTING_SUPPORTED_AGENTS,
  emptyRoutingSettingsView,
} from '../../../../shared/routing.js';

test('routing contracts keep agent identity separate from model source', () => {
  assert.deepEqual(ROUTING_AGENTS, ['claude', 'codex', 'cursor', 'opencode']);
  assert.deepEqual(ROUTING_SUPPORTED_AGENTS, ['claude', 'codex', 'opencode']);
  assert.equal(emptyRoutingSettingsView().bindings.cursor.source, 'native');
});

test('public connection DTO contains presence flags but no secrets', () => {
  const json = JSON.stringify(emptyRoutingSettingsView().connection);
  assert.equal(/password|apiKey|cookie|ciphertext/i.test(json), false);
  assert.equal(json.includes('hasAdminCredential'), true);
  assert.equal(json.includes('hasDataPlaneKey'), true);
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-contracts.test.ts
```

Expected: FAIL because `shared/routing.ts` does not exist.

**Step 3: Add complete shared types**

Define these values and types in `shared/routing.ts`:

```ts
export const ROUTING_AGENTS = ['claude', 'codex', 'cursor', 'opencode'] as const;
export const ROUTING_SUPPORTED_AGENTS = ['claude', 'codex', 'opencode'] as const;

export type RoutingAgent = (typeof ROUTING_AGENTS)[number];
export type RoutingSupportedAgent = (typeof ROUTING_SUPPORTED_AGENTS)[number];
export type RoutingModelSource = 'native' | '9router';
export type RoutingConnectionStatus =
  | 'disconnected'
  | 'checking'
  | 'connected'
  | 'degraded'
  | 'offline';

export type RoutingSafeError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type RoutingCapabilities = {
  readAccounts: boolean;
  writeApiKeyAccounts: boolean;
  testAccounts: boolean;
  readRoutes: boolean;
  writeRoutes: boolean;
  readUsage: boolean;
  claudeRuntime: boolean;
  codexRuntime: boolean;
  openCodeRuntime: boolean;
  cursorRuntime: false;
};

export type RoutingConnectionView = {
  configured: boolean;
  baseUrl: string | null;
  status: RoutingConnectionStatus;
  version: string | null;
  hasAdminCredential: boolean;
  hasDataPlaneKey: boolean;
  secureStorageAvailable: boolean;
  lastCheckedAt: string | null;
  lastError: RoutingSafeError | null;
  capabilities: RoutingCapabilities;
};

export type RoutingBindingView = {
  provider: RoutingAgent;
  source: RoutingModelSource;
  routeId: string | null;
  routeName: string | null;
  supported: boolean;
};

export type RoutingAccountView = {
  id: string;
  provider: string;
  name: string;
  authType: string;
  priority: number | null;
  active: boolean;
  status: 'healthy' | 'cooling' | 'limited' | 'failed' | 'unknown';
  lastError: string | null;
  expiresAt: string | null;
};

export type RoutingRouteView = {
  id: string;
  name: string;
  kind: string | null;
  models: string[];
};

export type RoutingUsageView = {
  period: 'today' | '7d' | '30d';
  requests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostMicrousd: number;
  byProvider: Array<{ id: string; requests: number; costMicrousd: number }>;
  staleAt: string | null;
};

export type RoutingUsageAlertView = {
  period: 'daily' | '30d';
  enabled: boolean;
  thresholdMicrousd: number;
};

export type RoutingSettingsView = {
  connection: RoutingConnectionView;
  bindings: Record<RoutingAgent, RoutingBindingView>;
  accountSummary: { total: number; degraded: number };
  routeSummary: { total: number };
  accounts?: RoutingAccountView[];
  routes?: RoutingRouteView[];
  usage?: RoutingUsageView;
  usageAlerts: RoutingUsageAlertView[];
};
```

Also export input DTOs for connection, account, route, binding, and alert mutations. Secret-bearing input types may contain `adminPassword` and `dataPlaneKey`, but no response type may contain those names.

Implement `emptyRoutingSettingsView()` with native bindings for all four agents and `supported: false` only for Cursor.

**Step 4: Run the test and both typecheckers**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-contracts.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add shared/routing.ts server/modules/routing/tests/routing-contracts.test.ts
git commit -m "feat(routing): add shared routing contracts"
```

---

### Task 2: Add user-scoped routing persistence

**Files:**
- Modify: `server/modules/database/schema.ts`
- Modify: `server/modules/database/migrations.ts`
- Modify: `server/modules/database/index.ts`
- Create: `server/modules/database/repositories/routing.ts`
- Create: `server/modules/database/tests/routing.db.integration.test.ts`

**Step 1: Write isolated database tests**

Use the existing `withIsolatedDatabase` pattern from `server/modules/database/tests/projects.db.integration.test.ts`. Cover:

1. One connection per user.
2. Ciphertext is stored but plaintext is absent from every routing table.
3. Provider defaults are isolated by user.
4. A session snapshot copies the current default once and remains unchanged after the default changes.
5. Deleting a connection removes that user's routing bindings and alerts through explicit repository cleanup.
6. Alert thresholds use integer micro-USD.

The core assertion should be:

```ts
routingDb.setProviderDefault(1, 'claude', {
  source: '9router',
  routeId: 'combo-1',
  routeName: 'quality-first',
});
routingDb.snapshotSessionBinding(1, 'session-1', 'claude');
routingDb.setProviderDefault(1, 'claude', { source: 'native' });

assert.equal(routingDb.getSessionBinding(1, 'session-1')?.source, '9router');
assert.equal(routingDb.getProviderDefault(1, 'claude')?.source, 'native');
```

**Step 2: Run the test to verify it fails**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/routing.db.integration.test.ts
```

Expected: FAIL because routing schema and repository are missing.

**Step 3: Add idempotent schema constants**

Add and export these tables from `schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS routing_connections (
  user_id INTEGER PRIMARY KEY,
  base_url TEXT NOT NULL,
  admin_secret_ciphertext TEXT NOT NULL,
  data_plane_key_ciphertext TEXT NOT NULL,
  upstream_version TEXT,
  capabilities_json TEXT,
  last_checked_at DATETIME,
  last_error_code TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routing_bindings (
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('claude','codex','cursor','opencode')),
  scope TEXT NOT NULL CHECK(scope IN ('provider','session')),
  scope_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source IN ('native','9router')),
  route_id TEXT,
  route_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider, scope, scope_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routing_usage_alerts (
  user_id INTEGER NOT NULL,
  period TEXT NOT NULL CHECK(period IN ('daily','30d')),
  threshold_microusd INTEGER NOT NULL CHECK(threshold_microusd >= 0),
  enabled BOOLEAN NOT NULL DEFAULT 0,
  last_notified_period_key TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, period),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Include the tables in `INIT_SCHEMA_SQL`. Execute the same constants from `runMigrations()` and add indexes for route IDs and session scope lookups.

**Step 4: Implement `routingDb`**

Export methods with typed inputs and outputs:

- `getConnection(userId)`
- `upsertConnection(userId, row)`
- `deleteConnectionAndSettings(userId)` inside one SQLite transaction
- `listConnectionUserIds()`
- `getProviderDefaults(userId)`
- `getProviderDefault(userId, provider)`
- `setProviderDefault(userId, provider, binding)`
- `snapshotSessionBinding(userId, sessionId, provider)`
- `getSessionBinding(userId, sessionId)`
- `deleteSessionBinding(userId, sessionId)`
- `listAlerts(userId)`
- `upsertAlert(userId, alert)`
- `markAlertNotified(userId, period, periodKey)`

Normalize database booleans and JSON at this repository boundary. Never parse capabilities in route handlers.

**Step 5: Export and verify**

Export `routingDb` from `server/modules/database/index.ts`.

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/routing.db.integration.test.ts
npm run typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add server/modules/database/schema.ts server/modules/database/migrations.ts server/modules/database/index.ts server/modules/database/repositories/routing.ts server/modules/database/tests/routing.db.integration.test.ts
git commit -m "feat(routing): persist user routing settings"
```

---

### Task 3: Implement fail-closed secret encryption

**Files:**
- Create: `server/modules/routing/routing-secret-store.ts`
- Create: `server/modules/routing/tests/routing-secret-store.test.ts`

**Step 1: Write failing encryption tests**

Test:

- A 32-byte base64 master key is required.
- Missing or malformed configuration reports `available: false` without crashing server startup.
- `seal()` uses a random IV, so the same plaintext encrypts differently twice.
- `open()` restores the value only with matching user and purpose AAD.
- Tampering and cross-user decryption fail with `ROUTING_SECRET_DECRYPT_FAILED`.
- Error messages never contain plaintext.

Example:

```ts
const key = Buffer.alloc(32, 7).toString('base64');
const store = createRoutingSecretStore(key);
const sealed = store.seal(7, 'data-plane-key', 'sk-secret');

assert.notEqual(sealed.includes('sk-secret'), true);
assert.equal(store.open(7, 'data-plane-key', sealed), 'sk-secret');
assert.throws(() => store.open(8, 'data-plane-key', sealed));
```

**Step 2: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-secret-store.test.ts
```

**Step 3: Implement AES-256-GCM envelopes**

Use Node `crypto` only. The format must be:

```text
v1.<base64url iv>.<base64url auth tag>.<base64url ciphertext>
```

Use 12 random IV bytes and AAD:

```ts
const aad = Buffer.from(`cloudcli:routing:${userId}:${purpose}`, 'utf8');
```

Expose:

```ts
export type RoutingSecretPurpose = 'admin-password' | 'data-plane-key';

export interface RoutingSecretStore {
  available: boolean;
  seal(userId: number, purpose: RoutingSecretPurpose, value: string): string;
  open(userId: number, purpose: RoutingSecretPurpose, envelope: string): string;
}

export function createRoutingSecretStore(encodedKey = process.env.CLOUDCLI_ROUTING_SECRET_KEY): RoutingSecretStore;
```

When unavailable, `seal` and `open` throw an `AppError` with code `ROUTING_SECURE_STORAGE_UNAVAILABLE` and status 503. Do not log the key or plaintext.

**Step 4: Verify and commit**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-secret-store.test.ts
npm run typecheck
git add server/modules/routing/routing-secret-store.ts server/modules/routing/tests/routing-secret-store.test.ts
git commit -m "feat(routing): encrypt router credentials"
```

---

### Task 4: Bootstrap the desktop master key with Electron safeStorage

**Files:**
- Create: `electron/routingSecretKey.js`
- Create: `electron/routingSecretKey.test.js`
- Modify: `electron/main.js`
- Modify: `electron/localServer.js`
- Modify: `package.json`

**Step 1: Write the failing Node test with an injected fake safeStorage**

The factory must be testable without importing Electron:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoutingSecretKeyManager } from './routingSecretKey.js';

test('fails closed when OS encryption is unavailable', async () => {
  const manager = createRoutingSecretKeyManager({
    safeStorage: { isEncryptionAvailable: () => false },
    storePath: '/unused',
  });
  assert.equal(await manager.loadOrCreate(), null);
});
```

Use a temporary directory and a fake reversible `encryptString`/`decryptString` implementation to verify persistence and file mode.

**Step 2: Run and confirm failure**

```bash
node --test electron/routingSecretKey.test.js
```

**Step 3: Implement secure desktop key persistence**

`routingSecretKey.js` must:

- Generate 32 random bytes and return base64.
- Persist only `safeStorage.encryptString(key).toString('base64')`.
- Write a versioned JSON record with mode `0o600`.
- Return `null` when `safeStorage.isEncryptionAvailable()` is false.
- Never fall back to plaintext, unlike the older cloud account helper.
- Return `null` and preserve the corrupt file for diagnostics when decryption fails.

In `main.js`, after `app.whenReady()`:

1. Construct the manager with `safeStorage` and `path.join(app.getPath('userData'), 'routing-secret-key.json')`.
2. Load or create the key.
3. Pass it to `LocalServerController` as `routingSecretKey`.

In `localServer.js`:

- Store the constructor value.
- Add `CLOUDCLI_ROUTING_SECRET_KEY` to the spawned server environment only when present.
- Add `CLOUDCLI_ROUTING_ALLOW_LOOPBACK_HTTP: 'true'` for the owned desktop server.
- Do not print either value in startup logs.

Add `test:electron` and include it in the full test workflow:

```json
"test:electron": "node --test \"electron/**/*.test.js\""
```

Do not make the main `test` script recursively invoke itself. Run both scripts separately in final verification.

**Step 4: Verify**

```bash
npm run test:electron
node --check electron/main.js
node --check electron/localServer.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add electron/routingSecretKey.js electron/routingSecretKey.test.js electron/main.js electron/localServer.js package.json
git commit -m "feat(desktop): bootstrap routing secret key"
```

---

### Task 5: Build the SSRF-safe outbound transport

**Files:**
- Create: `server/modules/routing/routing-target-policy.ts`
- Create: `server/modules/routing/nine-router-http.ts`
- Create: `server/modules/routing/tests/routing-target-policy.test.ts`
- Create: `server/modules/routing/tests/nine-router-http.test.ts`

**Step 1: Write policy tests before implementation**

Cover:

- Reject schemes other than HTTP and HTTPS.
- Reject embedded credentials, query strings, and fragments in the configured base URL.
- Normalize trailing `/v1`, `/api/v1`, and slashes to the 9router origin.
- Require HTTPS for non-loopback targets.
- Allow loopback HTTP only when `CLOUDCLI_ROUTING_ALLOW_LOOPBACK_HTTP=true`.
- Block private, link-local, multicast, documentation, carrier-grade NAT, and metadata ranges for IPv4 and IPv6.
- Reject a hostname if any A or AAAA answer is blocked.
- Accept only exact hosts in `CLOUDCLI_ROUTING_ALLOWED_HOSTS` and valid CIDRs in `CLOUDCLI_ROUTING_ALLOWED_CIDRS` as explicit self-host exceptions.
- Pin the validated DNS address for one request.

Use injected DNS lookup functions. Do not make public network calls in tests.

**Step 2: Write transport tests with a local fake server**

Test:

- JSON request and response.
- Connection, headers, body, and total timeout handling.
- A 3xx response is returned as `ROUTING_REDIRECT_REJECTED` and never followed.
- Bodies over 1 MiB fail before `JSON.parse`.
- Non-JSON and schema-invalid bodies become safe typed errors.
- Error messages contain origin and operation but never cookie or authorization values.

**Step 3: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/routing/tests/routing-target-policy.test.ts \
  server/modules/routing/tests/nine-router-http.test.ts
```

**Step 4: Implement the target policy**

Use `node:net` `BlockList`, `dns.promises.lookup({ all: true, verbatim: true })`, and explicit configuration parsing. Return:

```ts
type ValidatedRoutingTarget = {
  origin: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  pinnedAddress: string;
  family: 4 | 6;
  loopback: boolean;
};
```

Validate every DNS result before selecting one. Re-run resolution for every outbound request. Never cache an address beyond a request.

**Step 5: Implement `requestNineRouterJson`**

Use `node:http` or `node:https` with a custom `lookup` callback that returns the pinned address while preserving the original hostname for TLS SNI and certificate validation.

The function accepts an internal operation enum, not an arbitrary URL:

```ts
type NineRouterOperation =
  | 'health'
  | 'version'
  | 'authStatus'
  | 'login'
  | 'dataPlaneModels'
  | 'catalogModels'
  | 'accountsList'
  | 'accountCreate'
  | 'accountUpdate'
  | 'accountDelete'
  | 'accountTest'
  | 'routesList'
  | 'routeGet'
  | 'routeCreate'
  | 'routeUpdate'
  | 'routeDelete'
  | 'usageStats';
```

Map each enum to a fixed method and path. Dynamic IDs must pass `encodeURIComponent`. No caller may supply a path.

**Step 6: Verify and commit**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/routing/tests/routing-target-policy.test.ts \
  server/modules/routing/tests/nine-router-http.test.ts
npm run typecheck
git add server/modules/routing/routing-target-policy.ts server/modules/routing/nine-router-http.ts server/modules/routing/tests/routing-target-policy.test.ts server/modules/routing/tests/nine-router-http.test.ts
git commit -m "feat(routing): harden router outbound requests"
```

---

### Task 6: Implement the versioned NineRouterClient adapter

**Files:**
- Create: `server/modules/routing/nine-router-capabilities.ts`
- Create: `server/modules/routing/nine-router-client.ts`
- Create: `server/modules/routing/tests/nine-router-client.test.ts`

**Step 1: Build a controlled fake 9router contract server**

The test server must implement only the inspected `0.5.45` contracts:

- `GET /api/health` returns `{ ok: true }`.
- `GET /api/version` returns `{ currentVersion: '0.5.45' }`.
- `GET /api/auth/status` returns login mode.
- `POST /api/auth/login` sets `auth_token`.
- `GET /v1/models` requires the data-plane key.
- `GET /api/providers` returns `{ connections }` with planted secret fields to prove output sanitization.
- `GET/POST/PUT/DELETE /api/combos` contracts.
- `GET /api/usage/stats?period=today|7d|30d`.

Test successful login, cookie reuse, one cookie refresh, invalid password, invalid key, unknown version, malformed payload, and redaction.

**Step 2: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/nine-router-client.test.ts
```

**Step 3: Add a pinned capability profile**

Support `0.5.45 <= version < 0.6.0` initially. Unknown versions may use health, auth status, version, and `/v1/models` probes, but all management writes are disabled.

The profile maps CloudCLI operations to the inspected 9router paths. Do not derive a write payload from unknown upstream fields.

**Step 4: Implement `NineRouterClient`**

Constructor dependencies:

```ts
type NineRouterClientDependencies = {
  baseUrl: string;
  adminPassword: string;
  dataPlaneKey: string;
  request: typeof requestNineRouterJson;
  now?: () => Date;
};
```

Public methods:

- `validateConnection()`
- `listModels()` using the sanitized management catalog from `GET /api/models`
- `listAccounts()`
- `createApiKeyAccount(input)`
- `updateAccount(id, input)`
- `deleteAccount(id)`
- `testAccount(id)`
- `listRoutes()`
- `getRoute(id)`
- `createRoute(input)`
- `updateRoute(id, input)`
- `deleteRoute(id)`
- `getUsage(period)`

Keep the dashboard cookie in memory only. Reauthenticate before a management operation if no valid cookie exists. On a 401, refresh once for GET operations only. Do not automatically replay writes.

Map upstream payloads into shared DTOs. Explicitly omit `apiKey`, `accessToken`, `refreshToken`, `idToken`, cookies, raw request logs, and arbitrary `providerSpecificData`.

**Step 5: Verify and commit**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/nine-router-client.test.ts
npm run typecheck
git add server/modules/routing/nine-router-capabilities.ts server/modules/routing/nine-router-client.ts server/modules/routing/tests/nine-router-client.test.ts
git commit -m "feat(routing): add versioned 9router client"
```

---

### Task 7: Add the routing application service and module assembly

**Files:**
- Create: `server/modules/routing/routing.service.ts`
- Create: `server/modules/routing/routing-runtime.service.ts`
- Create: `server/modules/routing/routing.module.ts`
- Create: `server/modules/routing/index.ts`
- Create: `server/modules/routing/tests/routing.service.test.ts`
- Create: `server/modules/routing/tests/routing-runtime.service.test.ts`

**Step 1: Write service tests with injected repositories and client factory**

Cover:

- Unconfigured read returns `emptyRoutingSettingsView()` and no outbound call.
- Connection setup validates before encrypting and persisting.
- Failed validation persists nothing.
- Read DTOs expose presence flags only.
- Editing with omitted secrets reuses stored secrets.
- Clearing a required secret is rejected.
- Connection deletion removes CloudCLI state but sends no lifecycle or shutdown request to 9router.
- Cursor binding rejects `source: '9router'` with `ROUTING_RUNTIME_UNSUPPORTED`.
- A router binding requires an existing route ID.
- Account and route mutations are disabled for unknown version profiles.
- Session snapshots preserve the provider default at session creation.
- Runtime resolution returns `{ source: 'native' }` for missing bindings.
- Runtime resolution decrypts secrets only for `source: '9router'`.
- Runtime errors never include decrypted values.

**Step 2: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/routing/tests/routing.service.test.ts \
  server/modules/routing/tests/routing-runtime.service.test.ts
```

**Step 3: Implement `RoutingService` workflows**

Expose:

```ts
getSettings(userId, details)
connect(userId, input)
validateConnection(userId, input)
disconnect(userId)
setProviderBinding(userId, provider, input)
list/create/update/delete/test account
list/create/update/delete route
getUsage(userId, period)
setUsageAlert(userId, input)
```

Connection writes must:

1. Normalize and validate target policy.
2. Resolve replacement or existing secrets.
3. Construct a client.
4. Validate health, version, management auth, models, and data-plane key.
5. Encrypt secrets.
6. Persist metadata only after every required check succeeds.

Use `AppError` codes from the design document.

**Step 4: Implement `RoutingRuntimeService`**

Expose:

```ts
type RuntimeRoutingConfiguration =
  | { source: 'native' }
  | {
      source: '9router';
      baseUrl: string;
      openAiBaseUrl: string;
      apiKey: string;
      routeId: string;
      routeName: string;
    };

snapshotSessionBinding(userId, sessionId, provider)
resolveForRun(userId, sessionId, provider)
```

For a router source, resolve the stable route ID through `NineRouterClient.getRoute()` immediately before launch and use the current route name. Do not silently use a deleted or stale route name.

**Step 5: Assemble dependencies**

`routing.module.ts` may import repositories, notification interfaces, environment configuration, and the client factory. It must not auto-start timers or import provider modules.

Export only application-facing symbols from `index.ts`:

```ts
export { routingRoutes } from './routing.module.js';
export { routingRuntimeService } from './routing.module.js';
export { startRoutingUsageMonitor, stopRoutingUsageMonitor } from './routing.module.js';
```

The monitor functions may initially be no-ops until Task 14.

**Step 6: Verify and commit**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/routing/tests/routing.service.test.ts \
  server/modules/routing/tests/routing-runtime.service.test.ts
npm run typecheck
git add server/modules/routing/routing.service.ts server/modules/routing/routing-runtime.service.ts server/modules/routing/routing.module.ts server/modules/routing/index.ts server/modules/routing/tests/routing.service.test.ts server/modules/routing/tests/routing-runtime.service.test.ts
git commit -m "feat(routing): add routing workflows"
```

---

### Task 8: Expose authenticated, same-origin, rate-limited routing APIs

**Files:**
- Create: `server/modules/routing/routing.routes.ts`
- Create: `server/modules/routing/routing-request-guard.ts`
- Create: `server/modules/routing/tests/routing.routes.test.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/index.ts`

**Step 1: Write route tests with a fake service**

Mount `createRoutingRouter(fakeService)` in an Express test app. Cover:

- `GET /api/routing` returns the standard success envelope.
- `details=accounts,routes,usage` is parsed from an allowlist.
- Connection reads never return submitted secrets.
- Mutation bodies are forwarded as typed service inputs.
- Cross-origin mutation requests are rejected.
- Same-origin and no-Origin non-browser requests are accepted.
- Connection validation is limited to 5 requests per user per minute.
- Other writes are limited to 30 requests per user per minute.
- Dynamic IDs are decoded once and passed as values, never concatenated into an upstream path here.
- Service `AppError` values reach the standard error middleware.

**Step 2: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing.routes.test.ts
```

**Step 3: Implement the request guard**

For mutation methods:

- If `Origin` is absent, permit authenticated non-browser clients.
- If present, require exact origin match against `Host` or `X-Forwarded-Host` with the request protocol.
- Allow explicit origins only from `CLOUDCLI_TRUSTED_ORIGINS`.
- Reject `Sec-Fetch-Site: cross-site`.
- Never use a wildcard.

Implement a bounded in-memory fixed-window limiter. Limit map size, evict expired entries, and call `.unref()` on cleanup timers.

**Step 4: Implement thin routes**

Use `asyncHandler` and `createApiSuccessResponse`. Add:

```text
GET    /api/routing
PUT    /api/routing/connection
POST   /api/routing/connection/validations
DELETE /api/routing/connection
POST   /api/routing/accounts
PUT    /api/routing/accounts/:id
POST   /api/routing/accounts/:id/tests
DELETE /api/routing/accounts/:id
POST   /api/routing/routes
PUT    /api/routing/routes/:id
DELETE /api/routing/routes/:id
PUT    /api/routing/bindings/providers/:provider
PUT    /api/routing/usage-alerts/:period
```

Do not expose arbitrary methods or paths.

**Step 5: Mount the module**

In `server/index.ts`:

```ts
import { routingRoutes } from './modules/routing/index.js';
app.use('/api/routing', authenticateToken, routingRoutes);
```

Place it with other authenticated API modules before static file handling.

**Step 6: Verify and commit**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing.routes.test.ts
npm run typecheck
git add server/modules/routing/routing.routes.ts server/modules/routing/routing-request-guard.ts server/modules/routing/tests/routing.routes.test.ts server/modules/routing/routing.module.ts server/index.ts
git commit -m "feat(routing): expose protected routing API"
```

---

### Task 9: Snapshot model source at session creation and resolve it in runtime context

**Files:**
- Modify: `server/shared/types.ts`
- Modify: `server/modules/providers/services/provider-runtime.service.ts`
- Modify: `server/modules/providers/provider.routes.ts`
- Modify: `server/modules/providers/tests/provider-runtime.service.test.ts`
- Create: `server/modules/providers/tests/provider-routing-session.test.ts`

**Step 1: Extend failing runtime service tests**

Add a fake `resolveRoutingForRun` dependency and assert:

- It receives the authenticated `writer.userId`, app session ID, and provider.
- The resolved configuration appears on `ProviderRuntimeContext.routing`.
- Missing `writer.userId` produces native routing, not another user's configuration.
- A client-supplied `options.userId` cannot influence routing.

Core assertion:

```ts
assert.deepEqual(context.routing, {
  source: '9router',
  baseUrl: 'https://router.example',
  openAiBaseUrl: 'https://router.example/v1',
  apiKey: 'secret',
  routeId: 'route-1',
  routeName: 'quality-first',
});
```

**Step 2: Write a session route test**

Verify `POST /api/providers/sessions` calls `snapshotSessionBinding` after creating the stable app session ID and scopes it to `req.user.id`.

**Step 3: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/provider-runtime.service.test.ts \
  server/modules/providers/tests/provider-routing-session.test.ts
```

**Step 4: Add routing to `ProviderRuntimeContext`**

Import `RuntimeRoutingConfiguration` as a type through the routing module or move this internal union to `server/shared/types.ts` to avoid a feature-cycle. Add:

```ts
routing: RuntimeRoutingConfiguration;
```

Do not put connection passwords or dashboard cookies in this context.

**Step 5: Resolve routing from server-owned writer identity**

Make `providerRuntimeService.run` async. Resolve the numeric user ID only from `writer.userId`, never from browser options. Pass native routing when identity is unavailable.

The default dependency delegates to `routingRuntimeService.resolveForRun()`.

**Step 6: Snapshot at app-session creation**

After `sessionsService.createAppSession()` succeeds in `provider.routes.ts`, read the authenticated user ID and call:

```ts
await routingRuntimeService.snapshotSessionBinding(userId, result.sessionId, provider);
```

If snapshot persistence fails, call `sessionsService.deleteOrArchiveSessionById(result.sessionId, { force: true, deletedFromDisk: false })` before propagating the error. Do not return a session whose source semantics were not recorded.

**Step 7: Verify native behavior**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/provider-runtime.service.test.ts \
  server/modules/providers/tests/provider-routing-session.test.ts
npm test
npm run typecheck
```

Expected: all existing provider tests remain green.

**Step 8: Commit**

```bash
git add server/shared/types.ts server/modules/providers/services/provider-runtime.service.ts server/modules/providers/provider.routes.ts server/modules/providers/tests/provider-runtime.service.test.ts server/modules/providers/tests/provider-routing-session.test.ts
git commit -m "feat(providers): resolve per-session model source"
```

---

### Task 10: Inject 9router per run for Claude, Codex, and OpenCode

**Files:**
- Create: `server/modules/providers/shared/routing/runtime-routing-options.ts`
- Create: `server/modules/providers/tests/runtime-routing-options.test.ts`
- Modify: `server/modules/providers/list/claude/claude-runtime.provider.js`
- Modify: `server/modules/providers/list/codex/codex-runtime.provider.js`
- Create: `server/modules/providers/list/codex/codex-runtime.provider.test.js`
- Modify: `server/modules/providers/list/opencode/opencode-runtime.provider.js`
- Modify: `server/modules/providers/list/opencode/opencode-runtime.provider.test.js`

**Step 1: Write pure option-builder tests**

Cover native and router modes:

```ts
assert.deepEqual(buildClaudeRouteOptions({ source: 'native' }), {});
assert.deepEqual(buildCodexRouteOptions({ source: 'native' }), {});
assert.equal(buildOpenCodeRouteOptions({ source: 'native' }), null);
```

For router mode, assert exact endpoint, key, and route model values. Assert generated JSON parses and contains no native provider key.

**Step 2: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/runtime-routing-options.test.ts
```

**Step 3: Implement runtime-specific builders**

Claude:

```ts
{
  model: routeName,
  env: {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
  },
  unsetEnv: ['ANTHROPIC_API_KEY'],
}
```

Codex:

```ts
{
  model: routeName,
  client: {
    baseUrl: openAiBaseUrl,
    apiKey,
    env: { ...process.env },
  },
}
```

OpenCode:

```ts
{
  model: `cloudcli-9router/${routeName}`,
  env: {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      provider: {
        'cloudcli-9router': {
          npm: '@ai-sdk/openai-compatible',
          name: '9Router',
          options: { baseURL: openAiBaseUrl, apiKey },
          models: { [routeName]: { name: routeName } },
        },
      },
      model: `cloudcli-9router/${routeName}`,
    }),
  },
}
```

Do not write global CLI configuration files.

**Step 4: Integrate Claude**

Make `mapCliOptionsToSDK` merge route env into the per-run copy after native environment creation. Delete names in `unsetEnv`. Override the model with route name only in router mode.

Add assertions to an exported pure helper rather than testing the Anthropic SDK itself.

**Step 5: Integrate Codex**

Construct:

```js
codex = new Codex(routeOptions.client);
```

Use the route model in `threadOptions`. Native mode must still call `new Codex()` with no arguments. Test through an exported builder or an injected constructor seam.

**Step 6: Integrate OpenCode**

Merge generated route env after permission env so the selected source wins. Use the generated route model in `--model`. Native mode must leave current args and environment unchanged.

Extend the existing spawn mock test to assert the child receives `OPENCODE_CONFIG_CONTENT` only in router mode.

**Step 7: Run adapter tests**

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/runtime-routing-options.test.ts \
  server/modules/providers/list/codex/codex-runtime.provider.test.js \
  server/modules/providers/list/opencode/opencode-runtime.provider.test.js
npm test
npm run typecheck
```

**Step 8: Commit**

```bash
git add server/modules/providers/shared/routing/runtime-routing-options.ts server/modules/providers/tests/runtime-routing-options.test.ts server/modules/providers/list/claude/claude-runtime.provider.js server/modules/providers/list/codex/codex-runtime.provider.js server/modules/providers/list/codex/codex-runtime.provider.test.js server/modules/providers/list/opencode/opencode-runtime.provider.js server/modules/providers/list/opencode/opencode-runtime.provider.test.js
git commit -m "feat(providers): route supported agents through 9router"
```

---

### Task 11: Add the frontend routing API and isolated state hook

**Files:**
- Create: `src/components/settings/view/tabs/nine-router-settings/routingApi.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/routingState.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/routingState.test.ts`

**Step 1: Write response parsing and reducer tests**

Test:

- Standard success envelope parsing.
- Safe `AppError` envelope parsing.
- A malformed success payload is rejected.
- Submitted secret fields are cleared immediately after success and never copied into loaded state.
- Expanding accounts/routes/usage triggers a detail read once.
- Pessimistic mutation state disables only the active operation.
- A failed mutation preserves user-entered fields but does not place them in global state or logs.

**Step 2: Run and confirm failure**

```bash
npx tsx --test \
  src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts \
  src/components/settings/view/tabs/nine-router-settings/routingState.test.ts
```

**Step 3: Implement `routingApi.ts`**

Use `authenticatedFetch` from `src/utils/api.js`. Expose typed methods matching Task 8. Parse every response into shared DTO shapes. Throw a frontend `RoutingApiError` containing only code, safe message, status, and retryability.

Never log request bodies for connection or account mutations.

**Step 4: Implement state and hook**

The hook owns:

- Initial aggregate load.
- Lazy section detail load.
- Connection form state.
- One active mutation key.
- Inline safe errors.
- Pessimistic refresh after every successful mutation.
- Secret input clearing after successful connect or account creation.

Do not add routing state to `useSettingsController`.

**Step 5: Verify and commit**

```bash
npx tsx --test \
  src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts \
  src/components/settings/view/tabs/nine-router-settings/routingState.test.ts
npm run typecheck
git add src/components/settings/view/tabs/nine-router-settings/routingApi.ts src/components/settings/view/tabs/nine-router-settings/routingState.ts src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts src/components/settings/view/tabs/nine-router-settings/routingState.test.ts
git commit -m "feat(settings): add 9router settings state"
```

---

### Task 12: Add the single Settings page, connection card, and model-source rows

**Files:**
- Create: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/ConnectionSection.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/ModelSourceSection.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`
- Modify: `src/components/settings/types/types.ts`
- Modify: `src/components/settings/hooks/useSettingsController.ts`
- Modify: `src/components/settings/view/SettingsSidebar.tsx`
- Modify: `src/components/settings/view/Settings.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`
- Modify: `src/i18n/locales/zh-TW/settings.json`

**Step 1: Write a server-rendered component test**

Use `renderToStaticMarkup` with a small i18next test instance. Assert:

- Unconfigured state renders endpoint, password, data-plane key, and `Test and connect`.
- Password and key inputs use `type="password"`.
- Connected state does not contain either secret value.
- Connected state renders `Native login` and `9Router` for Claude, Codex, and OpenCode.
- Cursor renders native-only and disabled verification copy.
- There is no nested tab list.
- The page renders offline, unauthorized, incompatible, and secure-storage-unavailable alerts.

**Step 2: Run and confirm failure**

```bash
npx tsx --test src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx
```

**Step 3: Implement the connection section**

Reuse `SettingsSection`, `SettingsCard`, `Alert`, `Badge`, `Button`, and `Input`.

First-run fields:

- Endpoint.
- Admin password.
- Data-plane API key.
- One `Test and connect` primary action.

Connected header:

- Status badge.
- Origin and version.
- Last check.
- Test, edit, and disconnect actions.

Saved secret values are represented as `Configured`, never as masked reversible strings.

**Step 4: Implement model-source rows**

Use a two-button segmented control built from existing `Button` styles. The route `<select>` appears only when `9Router` is selected. Disable router selection when:

- No connection exists.
- The runtime capability is false.
- No route exists.
- Cursor is selected.

Copy must state that native login remains available and unchanged.

**Step 5: Register exactly one page**

- Add `'routing'` to `SettingsMainTab`.
- Add `'routing'` to `KNOWN_MAIN_TABS` in `useSettingsController.ts`. Do not add routing data or mutation state to that controller.
- Add one `Route` icon item to `SettingsSidebar` with `mainTabs.routing`.
- Import and render `NineRouterSettingsTab` in `Settings.tsx` when `activeTab === 'routing'`.
- Do not add internal navigation. Modify `useSettingsController` only to recognize the new tab ID in `KNOWN_MAIN_TABS`.

**Step 6: Add English and Chinese copy**

Add `mainTabs.routing` and a nested `nineRouter` object to the three locale files. Include explicit wording for:

- Native login preservation.
- Remote HTTPS requirement.
- Write-only credentials.
- Advisory usage alerts.
- Cursor unsupported state.
- No silent fallback.

**Step 7: Verify and commit**

```bash
npx tsx --test src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx
npm run typecheck
npm run build:client
git add src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx src/components/settings/view/tabs/nine-router-settings/ConnectionSection.tsx src/components/settings/view/tabs/nine-router-settings/ModelSourceSection.tsx src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx src/components/settings/types/types.ts src/components/settings/hooks/useSettingsController.ts src/components/settings/view/SettingsSidebar.tsx src/components/settings/view/Settings.tsx src/i18n/locales/en/settings.json src/i18n/locales/zh-CN/settings.json src/i18n/locales/zh-TW/settings.json
git commit -m "feat(settings): add single 9router settings page"
```

---

### Task 13: Add inline upstream and route management

**Files:**
- Create: `src/components/settings/view/tabs/nine-router-settings/UpstreamsRoutesSection.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/AccountEditor.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/RouteEditor.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/routeEditorState.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/UpstreamsRoutesSection.test.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/routeEditorState.test.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/useNineRouterSettings.ts`
- Modify: the three routing locale sections from Task 12

**Step 1: Write route editor state tests**

Test add, duplicate prevention, remove, move up, move down, first/last bounds, and stable order serialization.

```ts
assert.deepEqual(moveRouteTarget(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
assert.deepEqual(addRouteTarget(['a'], 'a'), ['a']);
```

**Step 2: Write component rendering tests**

Assert:

- The collapsed summary shows account, route, and degraded counts.
- `CollapsibleTrigger` has `aria-expanded`.
- Existing OAuth accounts render safely but the initial add form offers API-key accounts only.
- Account keys are password inputs and disappear after successful save.
- Route order buttons have accessible labels.
- Delete actions show inline confirmation before mutation.
- No raw upstream payload or request log is rendered.

**Step 3: Run and confirm failure**

```bash
npx tsx --test \
  src/components/settings/view/tabs/nine-router-settings/routeEditorState.test.ts \
  src/components/settings/view/tabs/nine-router-settings/UpstreamsRoutesSection.test.tsx
```

**Step 4: Implement inline account management**

Use `Collapsible` and `SettingsCard`. Group accounts by provider. Display auth type, priority, active state, health, expiry, and safe last error.

The first release creates API-key accounts only. Derive selectable LLM provider IDs from the safe `/api/models` adapter result. Existing OAuth accounts may be listed, tested, enabled, disabled, and deleted if the capability profile supports those operations. Do not proxy arbitrary OAuth paths.

**Step 5: Implement inline route management**

Use a searchable model list, accessible move buttons, duplicate prevention, and confirmed delete. Route names must match 9router's inspected regex:

```text
^[a-zA-Z0-9_.-]+$
```

Use stable route ID for bindings. Display name is refreshed after mutation.

**Step 6: Verify and commit**

```bash
npx tsx --test \
  src/components/settings/view/tabs/nine-router-settings/routeEditorState.test.ts \
  src/components/settings/view/tabs/nine-router-settings/UpstreamsRoutesSection.test.tsx
npm run typecheck
npm run build:client
git add src/components/settings/view/tabs/nine-router-settings src/i18n/locales/en/settings.json src/i18n/locales/zh-CN/settings.json src/i18n/locales/zh-TW/settings.json
git commit -m "feat(settings): manage 9router routes inline"
```

---

### Task 14: Add compact usage summaries and advisory alerts

**Files:**
- Create: `server/modules/routing/routing-usage-monitor.ts`
- Create: `server/modules/routing/tests/routing-usage-monitor.test.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/index.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/UsageSection.tsx`
- Create: `src/components/settings/view/tabs/nine-router-settings/UsageSection.test.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Modify: the three routing locale sections

**Step 1: Write monitor tests with a fake clock and notifier**

Cover:

- Disabled alerts make no usage calls.
- Daily and 30-day thresholds compare integer micro-USD.
- One notification per period key.
- A failed user connection does not stop checks for other users.
- Polling concurrency is bounded.
- Notification event contains totals and period but no prompt, response, key, or raw request metadata.

**Step 2: Run and confirm failure**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-usage-monitor.test.ts
```

**Step 3: Implement explicit lifecycle**

`createRoutingUsageMonitor()` returns `{ start, stop, runOnce }`. Use a five-minute unref'd interval and a concurrency limit of three. It must not start on import.

Wire `startRoutingUsageMonitor()` after database initialization in `startServer()` and `stopRoutingUsageMonitor()` into shutdown cleanup.

**Step 4: Write and implement the compact UI**

Render:

- Today, 7-day, and 30-day selector.
- Requests, prompt tokens, completion tokens, and estimated cost.
- CSS distribution bars by provider.
- Daily and 30-day warning controls.
- Clear `Advisory only` text.

No chart dependency, raw prompt, response, request log, or arbitrary metadata.

**Step 5: Verify and commit**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-usage-monitor.test.ts
npx tsx --test src/components/settings/view/tabs/nine-router-settings/UsageSection.test.tsx
npm run typecheck
npm run build
git add server/modules/routing/routing-usage-monitor.ts server/modules/routing/tests/routing-usage-monitor.test.ts server/modules/routing/routing.module.ts server/index.ts src/components/settings/view/tabs/nine-router-settings/UsageSection.tsx src/components/settings/view/tabs/nine-router-settings/UsageSection.test.tsx src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx src/i18n/locales/en/settings.json src/i18n/locales/zh-CN/settings.json src/i18n/locales/zh-TW/settings.json
git commit -m "feat(routing): add usage alerts and summary"
```

---

### Task 15: Complete locale coverage, security regression tests, and documentation

**Files:**
- Modify: `src/i18n/locales/de/settings.json`
- Modify: `src/i18n/locales/es/settings.json`
- Modify: `src/i18n/locales/fr/settings.json`
- Modify: `src/i18n/locales/it/settings.json`
- Modify: `src/i18n/locales/ja/settings.json`
- Modify: `src/i18n/locales/ko/settings.json`
- Modify: `src/i18n/locales/ru/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`
- Create: `server/modules/routing/tests/routing-security.integration.test.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-08-04-9router-api-only-design.md` only if implementation evidence changes a documented detail

**Step 1: Add a cross-boundary security test**

Exercise an Express app, isolated database, fake 9router, and runtime resolver together. Prove:

1. User A cannot read or mutate User B's connection, binding, or alert.
2. Browser responses never contain planted admin password, data-plane key, cookie, ciphertext, or upstream token.
3. Logs captured during failed login and malformed upstream responses contain none of those values.
4. A private target is rejected before any socket connects.
5. A redirect to metadata IP is not followed.
6. Native routing does not decrypt secrets or inject router variables.
7. Router routing uses the session snapshot and does not silently fall back.
8. Disconnect sends no 9router shutdown or lifecycle call.

**Step 2: Run and confirm any missing protection fails**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/routing/tests/routing-security.integration.test.ts
```

Fix the smallest responsible layer for each failure. Do not weaken assertions.

**Step 3: Complete locale keys**

Add the same `mainTabs.routing` and `nineRouter` key structure to every remaining settings locale. Use accurate translations where maintainable. If a translation cannot be confidently produced, use the English string rather than leaving a raw key or inventing unclear security copy.

**Step 4: Document setup and limitations**

Add a concise README section:

- User runs 9router separately.
- Open `Settings > 9Router`.
- Native agent login remains the default and remains untouched.
- Remote target requires HTTPS.
- Hosted/self-hosted deployments require `CLOUDCLI_ROUTING_SECRET_KEY` as 32 random bytes encoded in base64.
- Private self-host targets require explicit host/CIDR allowlists.
- Supported runtimes are Claude, Codex, and OpenCode.
- Cursor is not yet supported.
- Usage thresholds are advisory.

Include a non-shell-dependent key-generation example using Node:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

**Step 5: Run focused and full verification**

```bash
npm run test:electron
npx tsx --test \
  src/components/settings/view/tabs/nine-router-settings/routingApi.test.ts \
  src/components/settings/view/tabs/nine-router-settings/routingState.test.ts \
  src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx \
  src/components/settings/view/tabs/nine-router-settings/routeEditorState.test.ts \
  src/components/settings/view/tabs/nine-router-settings/UpstreamsRoutesSection.test.tsx \
  src/components/settings/view/tabs/nine-router-settings/UsageSection.test.tsx
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0.

**Step 6: Manual browser verification**

Use @browser-testing-with-devtools after starting the app with a controlled fake 9router fixture. Verify:

- One Settings sidebar item exists.
- No inner navigation tabs exist.
- First-run, connected, offline, unauthorized, unsupported-version, and secure-storage-unavailable states.
- Native login remains selected by default.
- Router source and route selector work for supported agents.
- Cursor remains disabled.
- Inline account and route disclosures work on desktop and mobile widths.
- Keyboard focus order, `aria-expanded`, labels, and confirmations.
- Network panel shows browser calls only to `/api/routing`, never to the 9router origin.
- Responses contain no secrets.

Capture screenshots or notes in the implementation PR description, not in the repository unless requested.

**Step 7: Review before commit**

Use @requesting-code-review and @code-review-and-quality. Resolve security, correctness, and maintainability findings. Re-run the full verification set after changes.

**Step 8: Commit**

```bash
git add src/i18n/locales server/modules/routing/tests/routing-security.integration.test.ts README.md docs/plans/2026-08-04-9router-api-only-design.md
git commit -m "docs(routing): document secure 9router setup"
```

---

## Completion checklist

- [ ] Exactly one `Settings > 9Router` page exists.
- [ ] Claude, Codex, OpenCode, and Cursor remain provider/runtime identities.
- [ ] Native login remains the default and is not read or modified.
- [ ] 9router is never bundled or supervised.
- [ ] Secrets are write-only and encrypted at rest.
- [ ] Desktop key bootstrap fails closed when safeStorage is unavailable.
- [ ] Hosted remote targets require HTTPS.
- [ ] SSRF, redirects, DNS rebinding, body size, timeout, origin, and rate-limit controls are tested.
- [ ] The browser never calls 9router directly.
- [ ] The backend exposes typed operations, not a generic proxy.
- [ ] Session routing source is sticky after creation.
- [ ] Claude, Codex, and OpenCode use per-run configuration only.
- [ ] Cursor remains native-only.
- [ ] Unknown 9router versions cannot perform guessed writes.
- [ ] Usage alerts are labeled advisory.
- [ ] Full tests, typecheck, lint, build, and browser verification pass.
