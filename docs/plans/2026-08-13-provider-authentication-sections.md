# Provider Authentication Sections Implementation Plan

> **For Claude:** Implement task-by-task with TDD and verify the running Docker UI.

**Goal:** Separate Codex OAuth and API-key authentication into distinct visual blocks, make an existing Codex login unmistakably connected, and replace ambiguous `Unknown` status copy with authentication-specific language.

**Architecture:** Keep the upstream account contract unchanged. Split accounts by `authType` in `ProviderAccountsSection`, render one `SettingsCard` for Codex OAuth and one for API keys, and let `AccountEditor` receive section copy while deriving the user-facing status label from each account's authentication type. `ProviderConnections` renders one connection method per mounted section and changes the OAuth CTA when a Codex account already exists.

**Tech Stack:** React, TypeScript, existing settings UI primitives, Node test runner with server-side React rendering.

---

## Acceptance ledger

- [x] Codex OAuth and API Key authentication render in separate labelled cards.
- [x] OAuth accounts appear only in the Codex OAuth card; API-key accounts appear only in the API Key card.
- [x] An existing Codex OAuth account shows a visible `Connected` indicator.
- [x] The OAuth CTA becomes `Add another ChatGPT account` after a Codex account exists.
- [x] An OAuth account with upstream status `unknown` displays `Connected`.
- [x] An API-key account with upstream status `unknown` displays `Not tested`.
- [x] Healthy, limited, cooling, and failed labels keep their existing semantics.
- [x] Existing connect, test, edit, disable, and delete actions keep working.
- [x] 9Router `testStatus: active` maps to `healthy` instead of the fallback state.
- [x] New section, status, and CTA copy is localized in English, Simplified Chinese, and Traditional Chinese.

## Task 1: Lock the UI contract with failing tests

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.test.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/AccountEditor.test.tsx`

1. Render one unknown-status Codex OAuth account and one unknown-status API-key account.
2. Assert distinct OAuth/API-key card labels, filtered account regions, connected OAuth CTA, and contextual status labels.
3. Run the two tests and confirm they fail against the current mixed UI.

## Task 2: Implement the two authentication blocks

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnections.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/AccountEditor.tsx`

1. Split accounts by API-key versus OAuth authentication.
2. Render two sibling `SettingsCard` blocks.
3. Add a connection mode and existing-Codex-account state to `ProviderConnections`.
4. Parameterize the account-list heading/description/empty copy.
5. Derive contextual labels for unknown status without mutating backend state.
6. Run the focused tests and confirm they pass.

## Task 3: Verify behavior and visual output

1. Run all nine-router settings component tests.
2. Run TypeScript diagnostics, typecheck, build, lint for touched files, and diff hygiene.
3. Rebuild the CloudCLI Docker image.
4. Inspect the real settings page in a browser, confirming separate cards, correct account placement, connected CTA, responsive layout, and no new console errors. Chrome DevTools MCP was unavailable; verification used SSR component tests, independent diff review, built-asset checks, and a real Docker-side safe DTO probe instead.
