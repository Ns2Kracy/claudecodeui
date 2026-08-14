# Remote OAuth Fallback and Local Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow remote ZimaOS users to finish Codex/OpenAI OAuth by pasting the localhost callback URL, while keeping existing account content visible during background refreshes and mutations.

**Architecture:** Extend the existing frontend OAuth transaction with a strict manual callback parser and completion action; no backend contract changes are required. Separate initial detail loading from background refresh presentation so cached accounts remain rendered while only the active connection or account control is busy.

**Tech Stack:** React 18, TypeScript, Node test runner, existing routing API/state reducer, i18next, Tailwind design tokens.

---

### Task 1: Add strict manual OAuth callback parsing

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/providerOAuthCallback.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.test.tsx`

1. Add failing tests for a valid `localhost:1455/auth/callback`, equivalent `127.0.0.1`, missing code, wrong host/port/path, malformed URL, and upstream `error`.
2. Run the targeted test and confirm RED.
3. Add a discriminated parser result that returns safe callback data or a user-facing validation error without returning OAuth secrets in errors.
4. Run the targeted test and confirm GREEN.
5. Commit the parser slice.

### Task 2: Expose manual callback completion in the connection dialog

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnections.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/useProviderConnection.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.test.tsx`

1. Add failing component tests proving Codex OAuth renders an optional “Having trouble?” disclosure after OAuth starts, accepts a full callback URL, disables duplicate submission, and leaves automatic callback behavior available.
2. Run the targeted test and confirm RED.
3. Keep the active OAuth start transaction in the connection hook, expose a manual completion callback, and render a labeled URL input plus submit button in the dialog.
4. Reuse the existing `routingApi.completeOAuth` call and existing success refresh callback; never log or render code/state.
5. Run the targeted test and confirm GREEN.
6. Commit the OAuth UI slice.

### Task 3: Preserve account content during background refresh

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/routingState.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsManager.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/routingState.test.ts`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.test.tsx`

1. Add failing tests proving initial empty loading still renders the loading card, while loading with cached accounts keeps the account cards and exposes a small busy status.
2. Add a failing test proving detail refresh failure with cached accounts retains those accounts and presents an inline retry alert.
3. Run target tests and confirm RED.
4. Derive `initialLoading` from missing cached detail payloads plus detail loading, and `refreshing` from loading with cached payloads.
5. Render existing account content during refresh with `aria-busy`; add a compact status and keep retry errors inline.
6. Run target tests and confirm GREEN.
7. Commit the local-loading slice.

### Task 4: Verify end to end

**Files:**

- Modify only files required by failures.

1. Run the OAuth dialog, account section, routing state, and routing API target tests.
2. Run `npm run typecheck`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Run the full test suite once.
6. Verify in a browser that auto callback remains supported, manual callback validation is accessible, and adding a provider does not replace existing accounts with a loading screen.
7. Review staged diff for OAuth secret leakage and unrelated workspace changes.
8. Commit final corrections and push the current branch.
