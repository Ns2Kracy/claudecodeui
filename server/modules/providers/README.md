# Providers Module Guide

The providers module has one active application provider: `codex`.

## Active Contract

`providerRegistry` registers only `CodexProvider`. Requests for `claude`,
`cursor`, or `opencode` are rejected with `UNSUPPORTED_PROVIDER`; their previous
runtime, authentication, model, MCP, skills, session, and synchronization
implementations have been removed.

The shared `LLMProvider` union may still contain legacy ids where needed to read
historical sessions and messages. That compatibility is not an active-provider
registry and must not be used to expose removed agents in new UI or API flows.

## Codex Facets

`CodexProvider` owns these provider facets:

- `runtime`: starts and aborts Codex SDK runs.
- `models`: exposes only models returned by configured 9Router accounts.
- `auth`: reports 9Router-managed OpenAI/Codex account state.
- `mcp`: manages Codex MCP configuration.
- `skills`: discovers Codex/Agents skills.
- `sessions`: normalizes Codex events and transcript history.
- `sessionSynchronizer`: indexes Codex transcript artifacts.

The corresponding shared interfaces live in `server/shared/interfaces.ts`:

- `IProviderRuntime`
- `IProviderModels`
- `IProviderAuth`
- `IProviderMcp`
- `IProviderSkills`
- `IProviderSessions`
- `IProviderSessionSynchronizer`

Application services resolve these facets through `providerRegistry`; callers
must not import a provider implementation directly.

## 9Router Boundary

Codex execution is route-only:

- authentication and OAuth are owned by the routing module;
- model discovery comes from configured routed accounts and preserves exact
  upstream model ids (for example `cx/...` or `deepseek/...`);
- every run requires 9Router runtime credentials and routed model provenance;
- no native model, credential, or runtime fallback is allowed.

The provider module consumes the routing module through its public barrel. Do
not import routing repositories or 9Router transport internals from provider
facets.

## File Layout

```text
server/modules/providers/
  provider.registry.ts
  provider.routes.ts
  services/
  shared/
  list/codex/
    codex.provider.ts
    codex-runtime.provider.js
    codex-auth.provider.ts
    codex-models.provider.ts
    codex-mcp.provider.ts
    codex-skills.provider.ts
    codex-sessions.provider.ts
    codex-session-synchronizer.provider.ts
```

## Adding Another Active Provider

Adding a provider is a product and API contract change, not only a new folder.
Before implementation, define its routing, authentication, model provenance,
historical-session compatibility, and frontend exposure.

If approved:

1. Implement all required facets under `list/<provider>/`.
2. Register the wrapper in `provider.registry.ts`.
3. Add explicit route-boundary validation and tests.
4. Update shared and frontend provider types only where the new provider is
   intentionally active.
5. Add provider-specific service tests, runtime tests, and UI contract tests.
6. Update this guide.

Do not copy removed Claude/Cursor/OpenCode implementations from git history as a
template. Use the current Codex wrapper and the standards in
`.agents/skills/backend-module-standards/SKILL.md`.

## Validation

Run at minimum:

```bash
npm run typecheck
npx eslint server/modules/providers src/components/provider-auth src/components/chat
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/provider.routes.test.ts \
  server/modules/providers/tests/provider-models.service.test.ts \
  server/modules/providers/tests/provider-runtime.service.test.ts
```

For route-only changes, also run the routing tests and verify that a sidecar
outage fails closed.
