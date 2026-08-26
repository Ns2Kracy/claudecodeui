# Landlock Workspace Isolation Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a bundled Landlock runner whenever Bubblewrap cannot run, and fail closed for every protected Codex launch when neither runner is usable.

**Architecture:** Keep all selection inside the existing Workspace policy service. It functionally probes Bubblewrap first, then the image-shipped Landlock executable, and returns the selected wrapper through the existing Codex SDK `codexPathOverride`. The runner is a small C program, not a new Node package or sandbox framework.

**Tech Stack:** TypeScript/Node.js backend services and tests, React Settings UI, Linux Landlock C API, Debian Docker image, Node test runner.

---

### Task 1: Model ordered runner availability in Workspace policy

**Files:**

- Modify: `server/modules/workspace/workspace-policy.service.ts:15-126,253-366`
- Modify: `server/modules/workspace/tests/workspace-policy.service.test.ts`
- Modify: `server/modules/settings/settings.service.ts:38-43`
- Modify: `server/modules/settings/tests/settings.service.test.ts`

**Step 1: Write failing runner-selection tests**

Add tests using injected functional probes that require:

```ts
assert.equal((await service.getPolicy()).isolationRunner, "bubblewrap");
assert.equal((await landlockFallback.getPolicy()).isolationRunner, "landlock");
await assert.rejects(
  noRunner.resolveCodexLaunch("/media/projects/team-a"),
  (error) => error instanceof AppError && error.code === "WORKSPACE_ISOLATION_UNAVAILABLE",
);
```

Also change the first-install/legacy test so missing `isolationConfigured` retains strict protection and fails closed when no runner is available. Keep the explicit `strictIsolation: false` normal-launch test.

**Step 2: Run the focused test to verify it fails**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/workspace/tests/workspace-policy.service.test.ts
```

Expected: FAIL because the policy result does not contain `isolationRunner`, fallback does not exist, and an unconfigured policy still launches normally.

**Step 3: Implement minimal typed selection**

In `workspace-policy.service.ts`:

- Define the private runner kind union `"bubblewrap" | "landlock"` and a selection result containing `runner`, wrapper path, availability, and one safe reason.
- Replace the single Bubblewrap-only dependency with an ordered probe list. The default list is Bubblewrap then Landlock; test fixtures inject probe outcomes without spawning processes.
- Preserve the public `isolationAvailable` boolean for existing Settings consumers and add public `isolationRunner: "bubblewrap" | "landlock" | null`.
- Remove the branch that turns an unconfigured strict policy into a normal launch. `resolveCodexLaunch` throws `WORKSPACE_ISOLATION_UNAVAILABLE` whenever `strictIsolation` is true and no selection exists.
- Return the selected runner's wrapper path as `codexPathOverride`; retain the controlled environment and project validation.
- Update Settings service dependency/result types so the field passes through unchanged.

**Step 4: Run focused tests to verify they pass**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/workspace/tests/workspace-policy.service.test.ts server/modules/settings/tests/settings.service.test.ts
```

Expected: PASS.

**Step 5: Commit the backend selection slice**

```bash
git add server/modules/workspace/workspace-policy.service.ts server/modules/workspace/tests/workspace-policy.service.test.ts server/modules/settings/settings.service.ts server/modules/settings/tests/settings.service.test.ts
git commit -m "feat: select Landlock when Bubblewrap is unavailable"
```

### Task 2: Add the image-shipped Landlock runner and functional probe

**Files:**

- Create: `scripts/codex-landlock-runner.c`
- Modify: `server/modules/workspace/workspace-policy.service.ts`
- Modify: `server/modules/workspace/tests/workspace-policy.service.test.ts`
- Modify: `docker/cloudcli/Dockerfile:10-26`

**Step 1: Write the failing helper/probe contract tests**

Add unit coverage asserting that the Landlock probe invokes its configured executable with `--probe`, a successful probe selects `landlock`, and a missing/broken helper contributes a safe unavailability reason rather than enabling normal mode.

Add a source/build assertion appropriate to this repository that the Dockerfile compiles `scripts/codex-landlock-runner.c` to `/usr/local/libexec/cloudcli/codex-landlock-runner` and marks it executable.

**Step 2: Run the focused tests to verify they fail**

Run the Task 1 workspace test command and the repository's Docker/package test that contains the new assertion.

Expected: FAIL because no Landlock executable or Docker compile directive exists.

**Step 3: Implement the minimal C runner**

Implement `scripts/codex-landlock-runner.c` with no third-party library:

- `--probe` queries `LANDLOCK_CREATE_RULESET_VERSION`, requires ABI >= 3, creates a small ruleset, applies `PR_SET_NO_NEW_PRIVS` and `landlock_restrict_self`, then executes `/usr/bin/true`.
- Normal mode requires absolute, non-symlink `CLOUDCLI_WORKSPACE_ROOT`, `CLOUDCLI_CODEX_BINARY`, `CLOUDCLI_CODEX_HOME`, and `CLOUDCLI_SANDBOX_TMP` paths. It creates only the fixed state/temp directories before restriction and rejects changed/symlinked paths.
- It creates a ruleset handling all ABI-3 filesystem rights, including `REFER` and `TRUNCATE`.
- It grants full required filesystem rights only to the validated project, state directory, and private temp directory; grants narrowly read/execute-only runtime rules for the real Codex binary and necessary system/library/certificate paths; grants minimal access to `/dev/null`, `/dev/urandom`, and `/proc` only if required by the executable.
- It calls `landlock_restrict_self` before `execve(CLOUDCLI_CODEX_BINARY, argv + 1, environ)` and exits with stable diagnostic/status 78 on setup failure.

In the Workspace service, provide fixed `CLOUDCLI_CODEX_HOME` and `CLOUDCLI_SANDBOX_TMP` values in the replaced environment, use the compiled executable as the Landlock wrapper path, and execute its `--probe` during the fallback probe.

In the Dockerfile, install explicit Linux UAPI headers if required, copy source after the application copy, compile with warning flags, and install only the resulting executable to `/usr/local/libexec/cloudcli/codex-landlock-runner`. Do not add a new runtime service or dependency.

**Step 4: Run focused tests to verify they pass**

Run the Task 1 tests plus the Docker/package test containing the compile assertion.

Expected: PASS.

**Step 5: Commit the runner slice**

```bash
git add scripts/codex-landlock-runner.c docker/cloudcli/Dockerfile server/modules/workspace/workspace-policy.service.ts server/modules/workspace/tests/workspace-policy.service.test.ts
git commit -m "feat: bundle Landlock workspace runner"
```

### Task 3: Prove the Landlock filesystem boundary in a Linux container

**Files:**

- Create: `scripts/test-codex-landlock-runner.sh`
- Modify: `docker/cloudcli/Dockerfile`
- Test: `scripts/test-codex-landlock-runner.sh`

**Step 1: Write the failing container-boundary test script**

Create a shell test that makes temporary `project`, `sibling`, `codex-home`, and `tmp` directories. It runs the launcher against `/bin/sh -c` and asserts:

```bash
# Allowed: write in project and Codex state.
touch "$project/allowed"
touch "$codex_home/state"

# Denied: sibling read, sibling write, and project-to-sibling rename.
! cat "$sibling/private"
! touch "$sibling/blocked"
! mv "$project/allowed" "$sibling/escaped"
```

The script must print `SKIP` and exit 0 only when the kernel/runtime reports Landlock unavailable; every other setup failure is nonzero. It must not claim an unavailable host passed the boundary test.

**Step 2: Run it to verify initial failure**

Run it inside an image/container after Task 2's executable exists:

```bash
docker run --rm --entrypoint /app/scripts/test-codex-landlock-runner.sh <local-image-tag>
```

Expected before the implementation: failure because the test script/runner does not exist; on a host without Landlock, `SKIP` with the capability reason is acceptable after implementation.

**Step 3: Make the executable testable in the image**

Copy the test script in the normal source copy, mark it executable, and ensure its `/bin/sh` command has all required runtime paths. Keep it manual/canary-only—do not make Docker build fail just because the build host's kernel lacks Landlock.

**Step 4: Run the container boundary test**

Run the same Docker command. On a Landlock-capable runtime, expected output includes allowed writes and denied sibling accesses; on an unsupported runtime, expected output is a clearly labeled capability skip.

**Step 5: Commit boundary coverage**

```bash
git add scripts/test-codex-landlock-runner.sh docker/cloudcli/Dockerfile
git commit -m "test: add Landlock workspace boundary canary"
```

### Task 4: Surface the selected protection mode in Settings

**Files:**

- Modify: `src/components/settings/view/tabs/workspace-settings/workspaceSettingsState.ts`
- Modify: `src/components/settings/view/tabs/workspace-settings/workspaceSettingsState.test.ts`
- Modify: `src/components/settings/view/tabs/workspace-settings/WorkspaceSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/workspace-settings/WorkspaceSettingsTab.test.ts`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`

**Step 1: Write failing state/UI tests**

Add cases mapping `isolationRunner: "bubblewrap"`, `"landlock"`, and `null` to translated status copy. Confirm the disabled unavailable choice does not prevent explicitly turning protection off.

**Step 2: Run frontend workspace tests to verify failure**

Run:

```bash
npx tsx --test src/components/settings/view/tabs/workspace-settings/workspaceSettingsState.test.ts src/components/settings/view/tabs/workspace-settings/WorkspaceSettingsTab.test.ts
```

Expected: FAIL because runner identity is unknown to state/UI.

**Step 3: Implement minimal UX copy**

Extend state parsing to retain a nullable runner. Display:

- Bubblewrap: full filesystem-view isolation;
- Landlock: filesystem access protection, project-external files are denied but not hidden;
- None: protection unavailable, strict launches are blocked until protection is explicitly disabled or the runtime is fixed.

Keep the existing single protection toggle and avoid a new runner selector: selection is automatic and security ordered.

**Step 4: Run frontend workspace tests to verify pass**

Run the Task 4 test command.

Expected: PASS.

**Step 5: Commit Settings status**

```bash
git add src/components/settings/view/tabs/workspace-settings src/i18n/locales/en/settings.json src/i18n/locales/zh-CN/settings.json
git commit -m "feat: show active workspace isolation runner"
```

### Task 5: Verify all Codex entry paths and release readiness

**Files:**

- Modify if test contracts require it: `server/modules/providers/tests/codex-runtime.provider.test.ts`
- Modify if test contracts require it: `server/modules/websocket/tests/shell-websocket.service.test.ts`
- Modify if test contracts require it: `server/modules/routing/tests/nine-router-package.test.ts`

**Step 1: Extend launch-path tests before changing contracts**

Add/adjust assertions that a Landlock-selected launch passes `/usr/local/libexec/cloudcli/codex-landlock-runner` through both the SDK runtime and agent-backed PTY path, with the same strict replaced environment. Confirm an unavailable strict runner never constructs either process.

**Step 2: Run entry-path tests to verify failure, then implement the smallest propagation fix**

Run:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime.provider.test.ts server/modules/websocket/tests/shell-websocket.service.test.ts
```

Expected before the propagation adjustment: assertions reference the new Landlock path and fail. Change only the established launch option plumbing if necessary.

**Step 3: Run targeted checks**

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/workspace/tests/workspace-policy.service.test.ts server/modules/settings/tests/settings.service.test.ts server/modules/providers/tests/codex-runtime.provider.test.ts server/modules/websocket/tests/shell-websocket.service.test.ts
npx tsx --test src/components/settings/view/tabs/workspace-settings/workspaceSettingsState.test.ts src/components/settings/view/tabs/workspace-settings/WorkspaceSettingsTab.test.ts
```

Expected: PASS.

**Step 4: Run release gates and inspect results**

```bash
npm test
npm run typecheck
npm run build
npx eslint server/modules/workspace/workspace-policy.service.ts server/modules/workspace/tests/workspace-policy.service.test.ts server/modules/settings/settings.service.ts server/modules/settings/tests/settings.service.test.ts
git diff --check
git status --short
```

Expected: all commands exit 0; only intended Landlock changes are present. Inspect staged diff for secrets before creating any release commit.

**Step 5: Commit final integration and prepare the next version**

```bash
git add server/modules/providers/tests/codex-runtime.provider.test.ts server/modules/websocket/tests/shell-websocket.service.test.ts
git commit -m "test: cover Landlock Codex launch paths"
```

Bump to a new release version (do not overwrite `1.37.12`) only after all gates and a real Linux/ZimaOS canary have evidence.
