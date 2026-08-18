# Web-only Electron Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the Electron desktop application and every Electron-only runtime, build, release, notification, and server-support path while preserving the browser client, Web Push, Node.js server, CLI, responsive desktop-width UI, and the user's current package dependency changes.

**Architecture:** Delete the native shell rather than deprecating it. Collapse notification delivery to Web Push, remove the Electron WebSocket transport and local-runtime discovery support, and keep ordinary browser/Windows/macOS compatibility code that is not tied to Electron. Protect the result with a repository-level Web-only invariant test plus the existing notification integration suite.

**Tech Stack:** React 18, Vite, TypeScript, Express, WebSocket, SQLite, Node test runner, npm lockfile, GitHub Actions.

---

### Task 1: Add a failing Web-only repository invariant

**Files:**

- Create: `src/web-only.test.ts`

**Step 1: Write the failing test**

Create a Node test that resolves the repository root from `process.cwd()`, parses `package.json`, and asserts:

```ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

test('the repository ships only the web application', () => {
  const packageJson = JSON.parse(read('package.json'));
  const removedPaths = [
    'electron',
    '.github/workflows/desktop-macos-branch-build.yml',
    '.github/workflows/desktop-release.yml',
    '.github/workflows/desktop-windows-branch-build.yml',
    'scripts/release/build-server-bundle.js',
    'scripts/release/prepare-desktop-app.js',
  ];

  for (const relativePath of removedPaths) {
    assert.equal(existsSync(path.join(root, relativePath)), false, `${relativePath} must be removed`);
  }

  assert.equal(Object.keys(packageJson.scripts).some((name) => name.startsWith('desktop')), false);
  assert.equal('server:bundle' in packageJson.scripts, false);
  assert.equal('build' in packageJson, false);
  assert.equal('electron' in packageJson.devDependencies, false);
  assert.equal('electron-builder' in packageJson.devDependencies, false);
  assert.doesNotMatch(read('src/hooks/useWebPush.ts'), /cloudcliDesktopNotifications/);
  assert.doesNotMatch(read('server/modules/websocket/services/websocket-server.service.ts'), /desktop-notifications/);
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test src/web-only.test.ts
```

Expected: FAIL because Electron files, scripts, dependencies, bridges, and WebSocket routing still exist.

**Step 3: Commit the red test**

```bash
git add src/web-only.test.ts
git commit -m "test: define web-only repository invariant"
```

---

### Task 2: Remove Electron packaging, release automation, and dependencies

**Files:**

- Modify: `package.json:11-122, 201-243`
- Modify: `package-lock.json`
- Modify: `.gitignore:141-147`
- Modify: `.dockerignore:8-10`
- Modify: `README.md:1-4, 105-113, 129`
- Delete: `electron/`
- Delete: `.github/workflows/desktop-macos-branch-build.yml`
- Delete: `.github/workflows/desktop-release.yml`
- Delete: `.github/workflows/desktop-windows-branch-build.yml`
- Delete: `scripts/release/build-server-bundle.js`
- Delete: `scripts/release/prepare-desktop-app.js`

**Step 1: Remove desktop manifest entries**

In `package.json`:

- Remove `electron/` from `files`.
- Remove `desktop`, `desktop:dev`, `desktop:stage`, `desktop:pack`, `desktop:dist:mac`, `desktop:dist:win`, `desktop:icon:mac`, and `server:bundle` scripts.
- Remove the top-level electron-builder `build` object.
- Remove `cross-env`, `electron`, `electron-builder`, and `sharp` from `devDependencies`; their only tracked consumers are Electron commands/icon generation.
- Remove the unused OS automation optional dependencies `@nut-tree-fork/nut-js` and `screenshot-desktop`.
- Preserve the user's existing `@openai/codex-sdk` update and `9router` removal.

**Step 2: Delete native application and release files**

Delete the complete `electron/` directory, all three desktop workflows, and both desktop/local-runtime release scripts listed above.

**Step 3: Remove obsolete ignore rules and documentation**

- Remove `.desktop-build`, Electron bundle, and now-unused `/release/` rules from `.gitignore`.
- Remove `release` and `.desktop-build` from `.dockerignore`.
- Change the README opening to “A web UI for desktop and mobile”.
- Remove the “Desktop Companion App” section and the “Desktop companion” comparison row.
- Keep “Desktop View”, responsive desktop layout copy, and `public/screenshots/desktop-main.png`; those describe the browser layout.

**Step 4: Regenerate the lockfile without running lifecycle scripts**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: exit 0; current unrelated dependency changes remain, while exact `node_modules/electron`, `node_modules/electron-builder`, `node_modules/@electron/*`, `cross-env`, native desktop automation packages, and their exclusive transitive dependencies disappear.

**Step 5: Verify manifest cleanup**

Run:

```bash
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); for (const k of ['electron','electron-builder','cross-env','sharp']) if (p.devDependencies?.[k]) throw new Error(k); for (const k of ['@nut-tree-fork/nut-js','screenshot-desktop']) if (p.optionalDependencies?.[k]) throw new Error(k); for (const k of ['node_modules/electron','node_modules/electron-builder']) if (l.packages?.[k]) throw new Error(k)"
```

Expected: exit 0.

**Step 6: Commit packaging removal**

```bash
git add package.json package-lock.json .gitignore .dockerignore README.md electron .github/workflows scripts/release
git commit -m "chore: remove Electron packaging and releases"
```

---

### Task 3: Collapse notification settings to the browser-only path

**Files:**

- Modify: `src/components/settings/view/Settings.tsx:1-129, 205-221`
- Modify: `src/components/settings/view/tabs/NotificationsSettingsTab.tsx:1-117`
- Modify: `src/hooks/useWebPush.ts:24-34`
- Modify: `src/components/settings/types/types.ts:39-45`
- Modify: `src/components/settings/hooks/useSettingsController.ts:116-145`
- Modify: `src/constants/branding.test.ts:77-78`
- Modify: `src/i18n/locales/en/settings.json:128-134`
- Modify: `src/i18n/locales/es/settings.json:128-134`
- Modify: `src/i18n/locales/ko/settings.json:128-134`
- Modify: `src/i18n/locales/zh-CN/settings.json:128-134`

**Step 1: Remove renderer bridge state and handlers**

In `Settings.tsx`:

- Remove the React hook import, `DesktopNotificationsState`, bridge lookup, state subscription, and enable/disable handlers.
- Pass only Web Push props to `NotificationsSettingsTab`.

**Step 2: Render Web Push unconditionally**

In `NotificationsSettingsTab.tsx`:

- Remove `isDesktop`, `desktopNotifications`, and desktop callback props.
- Delete the native notification branch and retain the current Web Push card as the only notification transport UI.

**Step 3: Remove the desktop preference field and bridge exclusion**

- Remove `desktop` from `NotificationPreferencesState` and frontend default/normalization logic.
- In `useWebPush.ts`, leave SSR, Notification API, and service-worker capability checks, but remove the `cloudcliDesktopNotifications` check.
- Remove the branding test assertion that requires the bridge literal.
- Delete `notifications.desktop` translation objects from the four locales that define them.

**Step 4: Run frontend checks**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
npx tsx --tsconfig server/tsconfig.json --test src/constants/branding.test.ts src/web-only.test.ts
```

Expected: typecheck passes; branding passes; Web-only test still fails only on backend Electron paths until Task 4.

**Step 5: Commit frontend cleanup**

```bash
git add src
 git commit -m "refactor: remove Electron notification UI"
```

---

### Task 4: Remove Electron-only backend notification and local-runtime support

**Files:**

- Modify: `server/modules/notifications/tests/notification-orchestrator.integration.test.ts:65-102`
- Modify: `server/modules/notifications/services/notification-orchestrator.service.ts:1-5, 276-290`
- Modify: `server/modules/notifications/index.ts:1-20`
- Modify: `server/modules/websocket/services/websocket-server.service.ts:1-12, 108-115`
- Modify: `server/modules/database/repositories/notification-preferences.ts:8-57`
- Modify: `server/modules/database/index.ts:1-10`
- Modify: `server/modules/database/schema.ts:72-88, 171-173`
- Modify: `server/modules/database/migrations.ts:1-10, 549-556`
- Modify: `server/index.ts:1-5, 47-50, 188-191, 297-357, 388-397, 438-449`
- Delete: `server/modules/notifications/services/desktop-notification-clients.service.ts`
- Delete: `server/modules/notifications/websocket/desktop-notifications-websocket.service.ts`
- Delete: `server/modules/notifications/notifications.routes.ts`
- Delete: `server/modules/database/repositories/notification-channel-endpoints.ts`

Apply `$backend-module-standards`: keep module imports through barrels, remove now-unused exports, and keep the WebSocket service transport-only.

**Step 1: Add a failing Web-only preference assertion**

Add this integration test before changing the repository:

```ts
test('notification preferences expose only browser channels', async () => {
  await withIsolatedDatabase(() => {
    const user = userDb.createUser('web-notification-user', 'hash');
    const preferences = notificationPreferencesDb.updatePreferences(Number(user.id), {
      channels: { inApp: true, webPush: true, sound: false },
      events: {},
    });

    assert.deepEqual(preferences.channels, {
      inApp: true,
      webPush: true,
      sound: false,
    });
  });
});
```

**Step 2: Run it to verify it fails**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/notifications/tests/notification-orchestrator.integration.test.ts
```

Expected: FAIL because normalized preferences still include `desktop: false`.

**Step 3: Remove the desktop delivery transport**

- Delete desktop client/WebSocket services.
- Remove their exports from `server/modules/notifications/index.ts`.
- Remove `/desktop-notifications` handling and import from the WebSocket server.
- Remove the desktop channel import and channel entry from the orchestrator.
- Change the dedupe integration test to enable `webPush` instead of desktop delivery; no subscription is needed because the orchestrator still treats the enabled channel as accepted and the empty delivery resolves safely.

**Step 4: Remove the unused notification endpoint API/storage**

Because Web Push still uses `push_subscriptions`, and `notification_channel_endpoints` is otherwise consumed only by the Electron transport:

- Delete `notifications.routes.ts` and its `/api/notifications` mount/import.
- Delete the endpoint repository and database barrel export.
- Remove the endpoint table schema constant, schema composition, migration creation, and indexes.
- Do not add a destructive migration for existing installations; an old unused table may remain in existing SQLite files, while new databases no longer create it.

**Step 5: Normalize only Web notification preferences**

Change the backend `NotificationPreferences` channels to exactly:

```ts
channels: {
  inApp: boolean;
  webPush: boolean;
  sound: boolean;
};
```

Remove dynamic extra-channel preservation so obsolete native channel keys are not returned or written again.

**Step 6: Remove local server marker support**

In `server/index.ts`:

- Remove `os` and `fsPromises` imports if no longer used.
- Remove the marker path, `getErrorCode`, marker write/remove functions, startup write, and shutdown removal.
- Keep `DISPLAY_HOST`, production/static serving, development redirects, normal server logs, session watcher cleanup, browser cleanup, and plugin shutdown.

**Step 7: Run targeted backend checks**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/notifications/tests/notification-orchestrator.integration.test.ts
npx tsc --noEmit -p server/tsconfig.json
npx tsx --tsconfig server/tsconfig.json --test src/web-only.test.ts
```

Expected: all pass.

**Step 8: Commit backend cleanup**

```bash
git add server
 git commit -m "refactor: remove Electron server support"
```

---

### Task 5: Verify the Web-only application end to end

**Files:**

- Modify only if verification exposes an orphaned Electron reference or broken Web path.

**Step 1: Search tracked runtime/configuration files**

Run:

```bash
git grep -In -E 'cloudcliDesktop|desktop-notifications|ELECTRON_|electron-builder|desktop:dist|desktop:pack|desktop:stage|\.desktop-build' -- ':!CHANGELOG.md' ':!docs/plans/*' || true
```

Expected: no output. Responsive UI comments such as “Desktop header/view” and OS compatibility code remain valid.

**Step 2: Run the full quality gates**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: each exits 0 with zero test failures, type errors, or lint errors.

**Step 3: Verify package contents**

Run:

```bash
npm pack --dry-run
```

Expected: package contains Web/server/CLI assets and no `electron/` directory or desktop release scripts.

**Step 4: Probe the production Web server**

After the build, start the server on an unused local port, fetch the root page, and stop it:

```bash
SERVER_PORT=3311 HOST=127.0.0.1 node dist-server/server/index.js > /tmp/cloudcli-web-only.log 2>&1 &
server_pid=$!
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3311/ >/tmp/cloudcli-web-only.html && break; sleep 1; done
kill "$server_pid"
test -s /tmp/cloudcli-web-only.html
```

Expected: curl succeeds and returns the built Web application HTML.

**Step 5: Review the final diff and commit any verification fixes**

```bash
git status --short
git diff --check
git diff --stat HEAD~4..HEAD
```

Expected: only Web-only removal changes plus the user's pre-existing dependency update/removal are present; no whitespace errors.
