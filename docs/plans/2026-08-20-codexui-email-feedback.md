# CodexUI Email Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the command trigger’s visual tooltip and route all sidebar feedback actions to <ningkun@icewhale.org> with a prefilled CodexUI issue subject.

**Architecture:** Keep the change inside the existing React components. Use native `mailto:` links and existing icon buttons; preserve accessibility with `aria-label` rather than a visible tooltip.

**Tech Stack:** React 18, TypeScript, Node test runner, Vite

---

### Task 1: Add regression coverage

**Files:**

- Modify: `src/components/chat/view/subcomponents/ChatComposer.test.ts`
- Create: `src/components/sidebar/view/subcomponents/SidebarFeedbackLinks.test.ts`

**Step 1:** Assert the command trigger no longer declares the `showAllCommands` tooltip and does declare an `aria-label`.

**Step 2:** Assert expanded and collapsed sidebar sources use `ningkun@icewhale.org`, the exact `mailto:` URL, and no longer use the community issue URL.

**Step 3:** Run the two tests and verify they fail before implementation.

### Task 2: Implement the minimal UI change

**Files:**

- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx`
- Modify: `src/components/sidebar/view/subcomponents/SidebarFooter.tsx`
- Modify: `src/components/sidebar/view/subcomponents/SidebarCollapsed.tsx`

**Step 1:** Replace the command trigger tooltip prop with `aria-label={t("input.showAllCommands")}`.

**Step 2:** Change both sidebar issue constants to `ningkun@icewhale.org` and `mailto:ningkun@icewhale.org?subject=CodexUI%20Issue`.

**Step 3:** Show the email address in expanded desktop/mobile layouts and use it for the collapsed link label/title. Remove browser-tab-only attributes from mail links.

### Task 3: Verify

**Step 1:** Run the targeted tests; expect all to pass.

**Step 2:** Run TypeScript type checking; expect exit code 0.

**Step 3:** Run the client build; expect exit code 0.

**Step 4:** Inspect the scoped diff and confirm the unrelated staged backend file was not modified.
