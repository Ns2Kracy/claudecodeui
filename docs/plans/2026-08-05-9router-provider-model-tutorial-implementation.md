# 9Router Provider and Model Tutorial Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create one concise Chinese tutorial skeleton covering provider configuration in 9Router and 9Router model selection in Claude Code UI.

**Architecture:** Keep the two services clearly separated and connect them only through the model data flow: providers are configured in 9Router, 9Router exposes models through `/v1/models`, and Claude Code UI displays those models in its model menu. Use lightweight SVG placeholders so final screenshots can replace them without restructuring the document.

**Tech Stack:** Markdown, SVG, repository documentation.

---

### Task 1: Add Screenshot Placeholders

**Files:**
- Create: `docs/tutorials/images/9router/01-provider-page.svg`
- Create: `docs/tutorials/images/9router/02-api-key-form.svg`
- Create: `docs/tutorials/images/9router/03-model-menu.svg`
- Create: `docs/tutorials/images/9router/04-selected-model.svg`

**Step 1: Create four lightweight SVG placeholders**

Each placeholder must name the expected screen, mark sensitive fields for redaction, and use a consistent 16:9 frame.

**Step 2: Verify the assets exist**

Run: `rg --files docs/tutorials/images/9router`

Expected: All four SVG paths are listed.

**Step 3: Commit**

```bash
git add docs/tutorials/images/9router
git commit -m "docs: add 9router tutorial image placeholders"
```

### Task 2: Create the Tutorial Skeleton

**Files:**
- Create: `docs/tutorials/9router-provider-and-model-selection.zh-CN.md`

**Step 1: Write the tutorial**

Include these sections:

1. Purpose and prerequisites.
2. Service responsibility diagram.
3. Configure an API-key provider in the independent 9Router service.
4. Brief notes for OAuth, device-code, and custom providers.
5. Verify that 9Router exposes models through `/v1/models`.
6. Select a 9Router model in the independent Claude Code UI service.
7. Send a test message.
8. Troubleshooting and screenshot replacement notes.

Link to the official Claude Code UI and 9Router repositories. Do not document deployment or imply that either UI links to the other.

**Step 2: Verify image references**

Run: `rg -n "images/9router/.*svg" docs/tutorials/9router-provider-and-model-selection.zh-CN.md`

Expected: Four image references are reported.

**Step 3: Commit**

```bash
git add docs/tutorials/9router-provider-and-model-selection.zh-CN.md
git commit -m "docs: add 9router provider and model tutorial"
```

### Task 3: Validate the Documentation

**Files:**
- Verify: `docs/tutorials/9router-provider-and-model-selection.zh-CN.md`
- Verify: `docs/tutorials/images/9router/*.svg`

**Step 1: Check Markdown links and terminology**

Run: `rg -n "跳转|/v1/models|Claude Code UI|9Router" docs/tutorials/9router-provider-and-model-selection.zh-CN.md`

Expected: `/v1/models`, Claude Code UI, and 9Router are present; no instruction claims the two interfaces link to each other.

**Step 2: Inspect the final diff**

Run: `git diff --check && git diff -- docs/tutorials docs/plans/2026-08-05-9router-provider-model-tutorial-implementation.md`

Expected: `git diff --check` produces no errors and the diff contains documentation-only changes.

**Step 3: Commit the plan if it remains uncommitted**

```bash
git add docs/plans/2026-08-05-9router-provider-model-tutorial-implementation.md
git commit -m "docs: plan 9router tutorial implementation"
```
