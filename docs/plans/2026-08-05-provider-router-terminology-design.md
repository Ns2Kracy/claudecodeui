# Provider and Router terminology design

## Goal

Remove user-visible `9router` branding from CloudCLI. Present the integration as native provider management and model routing while retaining the official 9router sidecar as an internal implementation detail.

## Terminology

- Use **Providers** for the settings entry and provider-management area.
- Use **Provider** or **Account** for OAuth connections, API keys, and custom provider nodes.
- Use **Router**, **Route**, and **Fallback** for model composition and routing behavior.
- Model choices show provider and model labels without exposing the `9router` source name.
- Missing saved routed models use a generic unavailable-provider message.

## Compatibility boundary

The change is presentational. Preserve all internal contracts, including:

- `9router:*` model identifiers and source metadata
- TypeScript module and adapter names
- REST endpoint contracts
- environment variables
- Compose service and image configuration
- official 9router API behavior and version pin

These identifiers remain available to code and tests but must not be rendered as product terminology.

## Error handling

Errors surfaced to users should refer to the provider router or routing service, not 9router. Internal diagnostics may retain concrete implementation names where they are not presented in the UI. Existing typed error codes and status codes remain unchanged.

## Change safety

The existing uncommitted edits to `NineRouterSettingsTab.tsx` are user-owned. Changes in that file must be merged surgically without discarding those edits. The protected `package.json`, `package-lock.json`, `findings.md`, `progress.md`, and `task_plan.md` files must not be modified or committed.

## Verification

- Search rendered UI and localization resources for remaining user-visible `9router` labels.
- Add or update focused tests for settings labels, model options, and surfaced errors.
- Confirm internal `9router:*` model routing remains unchanged.
- Run type checking, linting, tests, and production build.
