# Codex Provider Accounts Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship one clear Codex account surface for ChatGPT OAuth, five popular API-key providers, OpenAI-compatible endpoints, and connected-account management.

**Architecture:** Preserve the existing routing facade and controller, replace only the account connection/presentation layer, and add the smallest server-side Codex OAuth callback bridge required by 9Router's localhost contract. Keep upstream data untrusted and credentials write-only.

**Tech Stack:** TypeScript, React, Tailwind, lucide-react, node:test, React server rendering, Express, Docker Compose

---

### Task 1: Provider catalog and identity system

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderCatalog.ts`
- Create: `src/components/settings/view/tabs/nine-router-settings/ProviderIcon.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.test.tsx`

1. Add failing assertions for Codex OAuth plus OpenAI, Anthropic, Gemini, DeepSeek, and OpenRouter API-key profiles.
2. Run the targeted test and confirm the current catalog fails.
3. Add profile descriptions/icon identities and a compact accessible icon component, reusing the existing Codex mark.
4. Run the targeted test and commit the slice.

### Task 2: Progressive connection chooser

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnections.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/CustomProviderEditor.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.test.tsx`

1. Add failing render tests for primary Codex OAuth, popular API-key choices, one-at-a-time inline forms, and OpenAI Compatible advanced disclosure.
2. Implement the hierarchy and progressive disclosure with existing UI primitives.
3. Ensure cancellation/success clears secret state and unsafe OAuth URLs remain blocked.
4. Run targeted tests and commit the slice.

### Task 3: Codex OAuth through 9Router

**Files:**

- Modify: `server/modules/routing/routing-oauth.service.ts`
- Modify: `server/modules/routing/tests/routing-oauth.service.test.ts`
- Modify only if required by the callback contract: `server/modules/routing/routing.routes.ts`
- Modify only if required by the public service contract: `server/modules/routing/index.ts`

1. Add a failing backend test that models 9Router Codex authorization's localhost callback contract.
2. Implement a bounded, short-lived localhost callback bridge scoped to the requesting transaction; never expose code verifier, tokens, or upstream state.
3. Preserve normal same-origin callbacks for other providers and reject invalid/expired transactions.
4. Run routing OAuth and route tests, mechanically verify module exports, and commit the slice.

### Task 4: Connected-account list redesign

**Files:**

- Modify: `src/components/settings/view/tabs/nine-router-settings/AccountEditor.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.tsx`
- Modify: `src/components/settings/view/tabs/nine-router-settings/ProviderAccountsSection.test.tsx`

1. Add failing render tests for compact provider rows, health/auth labels, per-provider model counts, actions, and absence of the generic Add account form.
2. Render the connection chooser above the account list and keep edit/test/enable/delete behavior.
3. Add instructive empty/loading/error states without nested cards.
4. Run targeted tests and commit the slice.

### Task 5: Copy and localization

**Files:**

- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`
- Modify: `src/i18n/locales/zh-TW/settings.json`

1. Replace implementation-centric labels with task-oriented OAuth, API key, custom endpoint, status, and action copy.
2. Run localization/render tests and JSON parsing checks.
3. Commit the slice.

### Task 6: Final verification and Docker runtime

1. Run all targeted routing and settings tests.
2. Run `npm run typecheck`, ESLint on touched files, `git diff --check`, and `npm run build`.
3. Rebuild CloudCLI with Docker Compose and wait for both services to become ready.
4. Probe the authenticated routing account/model endpoint and the Codex OAuth start endpoint without logging credentials.
5. Use the configured browser MCP to verify desktop/mobile screenshots, keyboard focus, accessibility names, no console errors, and expected network requests.
6. Review the diff against this acceptance ledger and report any remaining limitation explicitly.
