# Direct Router Requests and CloudCLI 1.37.3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop Router health/version probes from blocking usable Router business APIs and release CloudCLI 1.37.3.

**Architecture:** Treat configured Router origin and credentials as sufficient to attempt a request. Account, model, provider, and runtime calls go directly to their real APIs even when cached status is unavailable. Startup may initialize the data-plane key through the real management API, but it does not call `/api/health` or `/api/version` and failure remains advisory.

**Tech Stack:** TypeScript, Node.js test runner, Docker Compose, npm package metadata.

---

### Task 1: Prove cached status cannot block real requests

**Files:**

- Modify: `server/modules/routing/tests/routing.service.test.ts`
- Modify: `server/modules/routing/tests/routing-runtime.service.test.ts`

1. Change the settings recovery test to require no `refresh` call and a direct client request while status is unavailable.
2. Change the runtime test to require credentials and a resolved route while status is unavailable.
3. Run both tests and confirm they fail against the existing gates.

### Task 2: Remove service and runtime readiness gates

**Files:**

- Modify: `server/modules/routing/routing.service.ts`
- Modify: `server/modules/routing/routing-runtime.service.ts`
- Modify: `server/modules/routing/routing.module.ts`

1. Remove refresh-before-request and `state !== ready` rejection paths.
2. Build clients from configured origin and credentials only.
3. Keep real request errors sanitized through the existing AppError boundary.
4. Run the focused routing service/runtime tests and confirm they pass.

### Task 3: Remove startup health/version probes

**Files:**

- Modify: `server/index.ts`
- Modify: `server/modules/routing/routing.module.ts`
- Modify: `server/modules/routing/index.ts`
- Modify: `server/modules/routing/tests/routing.module.test.ts`
- Modify: `server/modules/routing/tests/server-lifecycle-composition.test.ts`

1. Delete the `/api/health` and `/api/version` startup checker and exports.
2. Initialize the data-plane key directly through the real authenticated management API without blocking server startup.
3. Update lifecycle tests to reject startup health/version probes.
4. Run routing module and lifecycle tests.

### Task 4: Release CloudCLI 1.37.3

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `compose.prod.yaml`

1. Set package and lock versions to `1.37.3` without creating a Git tag.
2. Set the production image to `ns2kracy/cloudcli:1.37.3`.
3. Run full tests, typecheck, build, lint, Compose validation, and scans for Router health gating.
4. Commit the release changes.
