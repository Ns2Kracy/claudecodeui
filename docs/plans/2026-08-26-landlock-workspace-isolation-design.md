# Landlock Workspace Isolation Fallback Design

## Status

Accepted — 2026-08-26

## Goal

Keep Project Protection available on Linux container hosts where Bubblewrap cannot create namespaces, while ensuring that a strict Codex run never silently becomes an unrestricted run.

## Context

CloudCLI currently validates each project under the deployment workspace root, then starts Codex through a Bubblewrap wrapper when Project Protection is enabled. Bubblewrap is the preferred runner: it supplies a separate filesystem view and broader namespace isolation. Direct image installs on NAS platforms can deny `bwrap --unshare-user` because the container's user-namespace or LSM/seccomp policy differs from the Compose deployment.

Landlock is a Linux kernel LSM that can restrict filesystem access for a process and all its descendants. It does not hide external paths or create namespaces, but it can prevent the Codex process—including `danger-full-access` children—from reading, writing, or traversing paths outside an explicit allowlist.

DeepSeek Harness is a design reference, not a dependency. Its useful boundary is a same-world process runner selected by functional probes, with no silent unconfined passthrough for a protected invocation. CloudCLI does not need its multi-package provider framework, cross-platform runners, or policy registry.

Sources:

- Linux kernel Landlock documentation: <https://docs.kernel.org/userspace-api/landlock.html>
- Landlock ABI documentation: <https://man7.org/linux/man-pages/man7/landlock.7.html>
- DeepSeek Harness process sandbox design: <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md>

## Decision

### Ordered runner selection

For Project Protection:

1. Use Bubblewrap when its functional probe succeeds.
2. Otherwise use the bundled Landlock runner when its functional probe succeeds.
3. If neither probe succeeds, reject the launch with `WORKSPACE_ISOLATION_UNAVAILABLE`.

When the user explicitly turns Project Protection off, launch Codex normally. There is no automatic normal-mode fallback for a default or legacy strict policy. This replaces the Bubblewrap-only first-installation fallback.

The Settings API returns the selected usable runner (`bubblewrap`, `landlock`, or `none`) and a safe unavailability reason. The UI identifies Landlock as filesystem-only protection rather than claiming it is equivalent to Bubblewrap.

### Bundled runner

Add one small C launcher, `scripts/codex-landlock-runner.c`, and compile it in `docker/cloudcli/Dockerfile` to `/usr/local/libexec/cloudcli/codex-landlock-runner`. The existing Codex SDK integration uses its absolute path through `codexPathOverride`; no SDK fork and no host-installed helper are needed.

The launcher receives the already validated project directory and real Codex binary through the existing controlled environment. It queries the Landlock ABI, requires ABI 3 or newer, applies a restrictive ruleset with `PR_SET_NO_NEW_PRIVS` and `landlock_restrict_self`, then `execve`s Codex. ABI 3 is the minimum because it includes `REFER` and `TRUNCATE`, avoiding incomplete handling of rename/link and truncate behavior.

The allowlist is deliberately small:

- current validated project: read/write/create/remove/rename;
- Codex state directory and a private temporary directory: read/write;
- binary, dynamic-loader, certificate, and locale paths necessary to start Codex: read/execute only.

No parent workspace root or sibling project is allowlisted.

### Functional probes

The Workspace module owns runner selection. The existing Bubblewrap probe remains aligned to the Bubblewrap wrapper. The Landlock probe invokes the bundled launcher in a probe mode against a temporary directory and `/usr/bin/true`; success proves the actual container kernel, LSM state, syscall policy, image helper, and basic rule application together.

Landlock rules are inherited by fork, clone, and exec descendants and cannot be removed by the restricted process. If the host kernel lacks Landlock, the LSM is disabled, or the container seccomp profile blocks Landlock syscalls, the probe fails and strict execution fails closed.

## Limits

Landlock denies filesystem authority outside the allowlist but does not create mount, user, PID, IPC, network, or UTS namespaces. External paths may remain visible by name; access is denied. Network and process isolation continue to be the surrounding container's responsibility. Bubblewrap remains preferred whenever available.

## Verification

- Unit-test runner priority, explicit normal mode, strict failure when both runners fail, and legacy/default policy behavior.
- Test the Settings service/API contract for runner identity and unavailability reason.
- Compile and execute the Landlock launcher in the image; verify project writes work and sibling project reads, writes, and cross-project renames fail.
- Run targeted tests, full tests, typecheck, build, lint, and `git diff --check` before release.
