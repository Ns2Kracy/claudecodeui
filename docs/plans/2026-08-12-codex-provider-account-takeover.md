# Codex Provider Account Takeover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix current 9Router model parsing and make the Codex account settings screen reuse the Provider Router account manager.

**Architecture:** Extend the existing trust-boundary sanitizer for the current OpenAI model shape without synthesizing IDs. Use one data-owning Provider Accounts manager as the sole account surface under Agents → Codex → Account.

**Tech Stack:** TypeScript, React, node:test, react-dom/server, Docker Compose

---

### Task 1: Current provider model response

**Files:**

- Modify: `server/modules/routing/tests/nine-router-client.test.ts`
- Modify: `server/modules/routing/nine-router-client.ts`

1. Add a failing test with `{ provider, connectionId, models: [{ id, object, owned_by }] }`.
2. Run the routing client test and confirm `ROUTING_UPSTREAM_RESPONSE_INVALID`.
3. Pass the envelope provider into model sanitation; accept authoritative `id`, derive display name from optional alias/name/model or ID, and preserve old shape support.
4. Run the routing client tests.

### Task 2: Provider Accounts manager

**Files:**

- Create: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsManager.tsx`
- Delete: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Delete: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`

1. Move hook-owned account props into `ProviderAccountsManager`.
2. Render it only from Agents → Codex → Account.
3. Remove the duplicate Provider settings navigation and the manual Apply-to-Codex frontend action.

### Task 3: Codex account takeover

**Files:**

- Modify: `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.test.tsx`
- Modify: `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx`
- Modify: `src/components/settings/view/tabs/agents-settings/sections/AgentCategoryContentSection.tsx`
- Modify: `src/components/settings/view/tabs/agents-settings/types.ts`
- Delete: `src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx` if no consumers remain
- Modify: `src/components/settings/view/Settings.tsx`

1. Add a failing server-render test proving account content identifies the Provider Router manager and excludes the legacy Codex login card.
2. Render `ProviderAccountsManager` for the account category.
3. Remove obsolete Codex auth/login props and modal wiring if no other consumers remain.
4. Run targeted frontend tests.

### Task 4: Verification and Docker

1. Run targeted routing and settings tests.
2. Run `npm run typecheck`, lint for touched files, and `npm run build`.
3. Rebuild/recreate Docker services.
4. Probe authenticated `/api/routing?details=accounts,models`; require ready runtime with account/model arrays.
5. Preserve unrelated working-tree edits and report exact files changed.
