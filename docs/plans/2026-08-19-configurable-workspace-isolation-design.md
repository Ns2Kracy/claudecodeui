# Configurable workspace isolation design

## Goal

Keep the deployment-mounted root as the fixed application default while allowing an administrator to choose whether Codex is constrained to the current Chat project at runtime. The feature supports both trusted physical-sandbox hosts and shared NAS hosts without adding another container.

## Permission model

1. **Deployment mount boundary** — `WORKSPACES_ROOT` is the maximum directory exposed to CloudCLI (for example `/media`). It remains deployment-owned and cannot be widened from the UI.
2. **Application workspace default** — Projects, clone, and file-tree use the deployment mount directly. This is deployment-owned and has no Settings control; per-Chat protection determines the Agent filesystem view.
3. **Agent workspace protection** — Bubblewrap isolation is enabled by default and exposes only the current Chat project beneath the deployment mount, required runtime system paths read-only, and Codex state separately. The deployment mount authorizes which projects can run; it is never mounted wholesale for a project Chat. Users may explicitly turn protection off through the Project Permissions cards. Codex may still use `danger-full-access`, but with protection enabled it only sees that project filesystem view.

Docker `privileged` is not an Agent permission tier and is never configurable through the UI. Compose grants only `seccomp=unconfined` and `apparmor=unconfined`, which are required for Bubblewrap user namespaces and mount propagation on Docker hosts such as ZimaCube; it does not add `SYS_ADMIN` or other capabilities.

## Backend

A workspace feature module owns the persisted protection choice, path validation, Bubblewrap capability probe, and Codex launch configuration. The deployment root comes from `WORKSPACES_ROOT`, falling back to the user home, and is always the application root. Protection defaults to enabled when Bubblewrap is available. An unconfigured installation whose host cannot create the required user namespace runs normally without protection so it remains usable; later explicit user choices remain persisted.

`PUT /api/settings/workspace` accepts `{ strictIsolation }` and refuses enabled protection when Bubblewrap cannot complete a probe. `GET /api/settings/workspace` returns only the protection choice and capability status.

Project, clone, file-tree, and Codex paths use the fixed deployment default through the policy service. Changing the protection choice never changes which projects are registered or visible.

## Codex runtime

The TypeScript SDK remains unchanged. In strict mode its `codexPathOverride` points to a project-owned wrapper. The wrapper invokes the real native Codex binary through Bubblewrap. The SDK receives a sandbox-visible working directory under `/workspace`; normal mode continues to use the real path.

An explicit strict-mode choice is fail-closed. Missing Bubblewrap, failed capability probes, invalid paths, or wrapper setup errors reject the Codex run and never fall back to an unwrapped process. The only exception is an unconfigured first installation: an unavailable capability probe selects normal mode until the administrator makes an explicit choice.

## Frontend

Add a Project Permissions settings tab with two Codex-style permission cards: “Only this project (recommended)” and “Turn off project protection.” The deployment mount remains fixed and hidden from Settings; the page preserves an explicit save action.

## Verification

Tests cover defaults, containment, persistence, capability rejection, and Codex wrapper configuration. Build, typecheck, lint, and targeted backend/frontend tests provide regression coverage.
