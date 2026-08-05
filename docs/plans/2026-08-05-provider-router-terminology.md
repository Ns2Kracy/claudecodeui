# Provider and Router Terminology Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove user-visible 9router branding from CloudCLI while preserving all internal integration identifiers and behavior.

**Architecture:** Keep the existing `nineRouter` translation namespace, `9router:*` model values, component names, APIs, environment variables, and Compose service unchanged. Replace only rendered locale values and generic unavailable-model copy, with focused tests proving both the presentation boundary and internal compatibility.

**Tech Stack:** React, TypeScript, react-i18next, Node test runner, JSON locale resources.

---

### Task 1: Lock the presentation boundary with tests

**Files:**
- Modify: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`
- Modify: `src/components/chat/hooks/useChatProviderState.test.ts`

**Steps:**
1. Add assertions that the settings view renders Provider/Router terminology and no visible `9router` brand.
2. Change the unavailable routed-model expectation to generic provider wording while retaining the `9router:*` value and source metadata.
3. Run the two focused test files and confirm the new expectations fail.
4. Commit only after the implementation in Tasks 2 and 3 makes them pass.

### Task 2: Replace localized product terminology

**Files:**
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh-CN/settings.json`
- Modify: `src/i18n/locales/zh-TW/settings.json`

**Steps:**
1. Change the settings navigation label from `9Router` to the locale equivalent of `Providers`.
2. Replace rendered titles, descriptions, runtime notices, compatibility errors, disclosure text, and onboarding copy with Provider/Router vocabulary.
3. Keep the `nineRouter` JSON key intact because it is an internal translation namespace.
4. Search locale values and confirm no rendered string contains case-insensitive `9router`.
5. Parse all three JSON files to confirm valid syntax.

### Task 3: Generalize routed-model unavailable copy

**Files:**
- Modify: `src/components/chat/hooks/useChatProviderState.ts`
- Test: `src/components/chat/hooks/useChatProviderState.test.ts`

**Steps:**
1. Preserve detection of the internal `9router:` prefix.
2. Replace the visible fallback label with `<model> (Provider unavailable)`.
3. Run the focused hook test and confirm it passes.

### Task 4: Preserve and validate the user-owned tab changes

**Files:**
- Inspect only unless required: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.tsx`
- Test: `src/components/settings/view/tabs/nine-router-settings/NineRouterSettingsTab.test.tsx`

**Steps:**
1. Keep the user's removal of the duplicate title and runtime status card intact.
2. Adjust tests to match the current intended layout without reverting those removals.
3. Run the focused settings test and confirm it passes.
4. Review the diff and verify no protected file was changed by this work.

### Task 5: Full verification and commit

**Files:**
- Do not modify or commit: `package.json`, `package-lock.json`, `findings.md`, `progress.md`, `task_plan.md`

**Steps:**
1. Run the focused UI tests.
2. Run `npm run typecheck`.
3. Run `npm run lint`.
4. Run the full test suite using the repository test script.
5. Run `npm run build`.
6. Search rendered source and locale values for remaining user-visible `9router` copy, distinguishing allowed internal identifiers.
7. Review the final diff for scope and protected-file safety.
8. Commit only files created or modified for this terminology change.
