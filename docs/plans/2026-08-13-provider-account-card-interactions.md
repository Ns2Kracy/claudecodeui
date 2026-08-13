# Provider Account Card Interactions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make account cards action-light, state-explicit, safe to disable, and visibly testable.

**Architecture:** Keep server state ownership in useNineRouterSettings and local ephemeral test/menu/confirmation state in AccountEditor. Reuse the existing ActionMenu and account-test API contract; measure elapsed time at the AccountEditor boundary.

**Tech Stack:** React, TypeScript, react-i18next, shared ActionMenu/Button/Badge/Input primitives, Node test runner with React server rendering.

---

### Task 1: Preserve the account-test result contract

**Files:**

- Modify: src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.tsx
- Modify: src/components/settings/view/tabs/nine-router-settings/AccountEditor.tsx
- Test: src/components/settings/view/tabs/nine-router-settings/AccountEditor.test.tsx

1. Change onTestAccount/onTest from Promise<boolean> to Promise<RoutingAccountTestResult | null>.
2. Add a failing component-contract test proving success/failure details can be rendered.
3. Implement account-local elapsed time, timestamp, loading, summary, and expandable details.
4. Run the focused AccountEditor test.

### Task 2: Clarify status semantics and action hierarchy

**Files:**

- Modify: src/components/settings/view/tabs/nine-router-settings/AccountEditor.tsx
- Test: src/components/settings/view/tabs/nine-router-settings/AccountEditor.test.tsx

1. Add failing markup assertions for three labeled state fields, persistent Test, and More menu trigger.
2. Replace ambiguous badges with Connection status / Health status / Authentication fields.
3. Move Edit, enabled-state switch, and Delete into ActionMenu.
4. Run the focused AccountEditor test.

### Task 3: Add safe disable confirmation

**Files:**

- Modify: src/components/settings/view/tabs/nine-router-settings/AccountEditor.tsx
- Test: src/components/settings/view/tabs/nine-router-settings/AccountEditor.test.tsx

1. Add an initial-state test hook for pending disable so SSR can verify the confirmation copy and controls.
2. Implement pending-disable state; enabling remains immediate, disabling requires inline confirmation.
3. Ensure per-account operations are disabled while that account is mutating.
4. Run the focused AccountEditor test.

### Task 4: Localize and verify

**Files:**

- Modify: src/i18n/locales/*/settings.json
- Test: src/components/settings/view/tabs/nine-router-settings/AccountEditor.test.tsx

1. Add account-card labels/actions/test-result/confirmation strings to every settings locale.
2. Run focused tests, changed-file lint, full typecheck, full test suite, and production build.
3. Rebuild Docker and verify the settings page/API remains healthy. Use Chrome DevTools if configured; otherwise document the unavailable browser MCP and use component/runtime probes.
