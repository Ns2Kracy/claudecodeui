# Configurable Workspace Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a settings-controlled workspace root and optional Bubblewrap enforcement so Codex `danger-full-access` cannot reach other mounted NAS directories.

**Architecture:** A workspace backend module owns persisted policy and validation. Existing project and file-tree boundaries delegate to it, while the Codex SDK receives either its normal executable or a Bubblewrap wrapper through `codexPathOverride`. A dedicated settings tab reads and updates the global policy.

**Tech Stack:** TypeScript, Express, React, OpenAI Codex SDK, SQLite `app_config`, Bubblewrap, Node test runner.

---

### Task 1: Workspace policy service
- Create `server/modules/workspace/workspace-policy.service.ts`, its barrel, and tests.
- Test defaults, containment, persistence, symlink resolution, strict capability rejection, and sandbox cwd mapping before implementation.

### Task 2: Settings API
- Add `GET /api/settings/workspace` and `PUT /api/settings/workspace` through the existing thin settings route/service/module structure.
- Add settings service tests.

### Task 3: Dynamic application boundary
- Route project creation, clone, and file-tree policy through the workspace module.
- Add or update focused tests proving paths outside the configured root are rejected.

### Task 4: Strict Codex launcher
- Add `scripts/codex-bwrap-wrapper.sh` and install Bubblewrap in `docker/cloudcli/Dockerfile`.
- Use SDK `codexPathOverride`, map cwd to `/workspace`, and fail closed when strict isolation cannot run.
- Add Codex runtime tests.

### Task 5: Workspace settings UI
- Add a Workspace tab, API state, English and Simplified Chinese copy, strict toggle, capability status, and explicit save.
- Add focused frontend tests for tab normalization and response normalization.

### Task 6: Verification and review
- Run targeted tests, typecheck, lint, build, diagnostics, and a final security-focused diff review.
