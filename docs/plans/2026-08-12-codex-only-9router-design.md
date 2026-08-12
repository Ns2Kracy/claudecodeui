# Codex-only 9Router Agent Design

**Date:** 2026-08-12

## Goal

CloudCLI supports one coding agent: Codex. Model discovery, account authentication, and every Codex inference run go through 9Router. Claude Code, Cursor, and OpenCode are removed from the supported provider surface.

## Decisions

- `LLMProvider` has one valid value: `codex`.
- The provider registry registers only `CodexProvider`.
- Claude Code, Cursor, and OpenCode provider implementations, tests, settings, choices, logos, and provider-specific branches are deleted when they have no remaining consumer.
- Existing database rows for removed providers are preserved to avoid destructive migration, but they are excluded from active supported-provider flows and cannot start new runs.
- The existing `ProviderLoginModal` shell is retained for settings and onboarding. Its terminal-based `codex login` body is replaced by the existing 9Router OAuth/device authorization API.
- CloudCLI does not read Codex `auth.json`, store OpenAI OAuth tokens, or execute `codex login`.
- Codex authentication status is derived from usable 9Router Codex/OpenAI accounts.
- The Codex model catalog contains only exact model IDs returned through configured 9Router accounts. IDs such as `cx/...` and `deepseek/...` are preserved; CloudCLI adds no namespace.
- Every run requires routed provenance and a resolved 9Router runtime configuration. Missing account, unavailable catalog, unknown model, sidecar failure, or missing route credentials fails closed. There is no native fallback.

## Architecture

### Provider boundary

Shared frontend and backend provider contracts are narrowed to `codex`. Request parsing rejects all other provider names. Defaults for projects, sessions, chat, MCP, skills, settings, onboarding, and task generation become Codex. Provider-specific modules for removed agents are deleted after consumers are migrated.

### Authentication flow

`ProviderLoginModal` remains the user-facing shell. When opened it starts 9Router Codex authorization using same-origin `/api/routing/oauth/*` routes. Browser OAuth uses the existing public callback and exchange transaction. Device authorization uses the existing device-code and polling endpoints when selected or required. Completion refreshes 9Router accounts, routed models, and the provider auth status. Errors, cancellation, and timeout are rendered inside the modal with a retry action.

The legacy provider auth status endpoint may remain as a compatibility facade, but its Codex result is computed from 9Router account state; it does not inspect local Codex credentials.

### Model and runtime flow

1. 9Router lists configured accounts and their available models.
2. CloudCLI exposes only those routed models in the Codex picker.
3. Selection stores the exact model ID with `model_source = '9router'`.
4. `chat.send` resolves durable provenance and 9Router runtime credentials before starting a provider run.
5. Codex runtime receives the 9Router base URL, API key, and exact model ID.

Native Codex model discovery is not merged into the list. `native` provenance is invalid for a Codex run after migration.

## Error handling

- Unsupported provider: boundary validation error.
- No usable routed account: unauthenticated status and disabled send.
- Empty model catalog: no fabricated default model.
- Unknown or stale selected model: `PROVIDER_MODEL_UNAVAILABLE`.
- Non-routed Codex run: routing-required conflict/error before spawning Codex.
- OAuth cancellation/expiry/upstream failure: modal error with retry; no local-login fallback.

## Migration and compatibility

The database is not destructively rewritten. Historical non-Codex rows remain stored, but unsupported providers are not offered and runtime dispatch rejects them. Current Codex session model provenance is persisted so a transient catalog failure cannot silently change a routed model into a native run.

## Verification

- Public provider types and registry expose only Codex.
- Removed provider request parameters are rejected.
- Existing login modal uses 9Router OAuth APIs and never renders or launches `codex login`.
- Provider auth status reflects 9Router account availability.
- Model lists contain only configured 9Router models.
- Every Codex run resolves 9Router credentials and rejects native/unknown provenance.
- Removed provider implementation directories and unneeded UI branches have no remaining imports.
- Targeted tests, typecheck, lint, build, and a Docker/runtime probe pass.
