# 9router Sidecar REST Integration Design

Date: 2026-08-05
Status: Approved

## Goal

Run the official `9router@0.5.45` runtime as a Docker Compose sidecar and integrate it into CloudCLI through authenticated same-origin REST APIs. CloudCLI must not reimplement 9router routing, OAuth, provider management, model discovery, or inference behavior.

Users retain two direct paths:

1. Use an already authenticated native agent such as Claude or Codex without configuring 9router.
2. Configure providers in 9router, then select a provider model exposed by 9router from the normal chat model selector.

Remove the separate model-source choice and remove usage estimates from the product UI.

## Architecture

### Runtime ownership

Docker Compose owns the 9router container lifecycle. CloudCLI does not spawn, restart, signal, or kill a 9router process and does not require access to the Docker socket.

The sidecar runs the pinned official `9router@0.5.45` package or pinned image artifact. It stores its database and OAuth/provider state in a dedicated persistent volume. Its HTTP port is available only on the Compose network and is not published to the host.

CloudCLI receives the internal origin through `NINE_ROUTER_BASE_URL`, defaulting to the Compose service URL in container deployments. Local non-Compose development may explicitly supply another loopback URL.

### Trust boundary

The browser never connects to 9router directly. All browser calls remain same-origin CloudCLI calls protected by CloudCLI authentication and mutation guards.

CloudCLI holds sidecar management credentials and the data-plane key. These secrets are sent only over the private container network, are never included in browser responses, and are redacted from errors and logs.

CloudCLI validates every upstream response before returning a stable product-facing representation.

### REST surfaces

CloudCLI retains `/api/routing/*` as its authenticated product-facing facade. It delegates provider catalog, OAuth/device flows, accounts, custom provider nodes, routes, model discovery, and model inference to the official sidecar REST API.

Runtime management semantics change:

- Status is derived from a bounded sidecar health request.
- Restart no longer manipulates a process. The endpoint is removed or returns an explicit unsupported response.
- A sidecar outage degrades only 9router-backed features. Native agents continue to work.

The inference boundary uses a CloudCLI endpoint that accepts a selected 9router model identifier and forwards the request to 9router's official data-plane REST endpoint. Streaming is proxied without buffering where supported by the official endpoint.

## Model selection

The chat composer has one model selector, not a separate source selector.

Its catalog combines:

- Native models already returned for the active logged-in agent.
- 9router models returned by the authenticated CloudCLI routing API when the sidecar is ready and configured.

Entries carry an internal discriminant rather than asking users to choose a source. Native entries retain their existing provider model value. 9router entries use an unambiguous namespaced value such as `9router:<upstream-model-id>` internally while displaying the upstream provider and model name.

When a native entry is selected, the existing agent execution path is unchanged. When a 9router entry is selected, the message is sent through the 9router REST data plane. A missing or unhealthy sidecar removes or disables only 9router entries and never blocks native sending.

Session model persistence stores the discriminated model selection so reopened sessions retain the correct execution path.

## Settings UX

The 9router settings tab focuses on:

- Sidecar connection status.
- Provider catalog.
- OAuth, device-code, API-key, and custom-provider connection flows supported by official 9router.
- Connected accounts and available provider models.
- Optional official 9router route configuration where still needed by its own data plane.

Remove `ModelSourceSection` and per-agent native/9router bindings. Users choose the desired provider model at chat time instead.

Remove usage estimation, cost summaries, automatic usage-detail fetching, and associated alerts from this integrated UI. No CloudCLI-side estimate is substituted.

## Failure handling

- Sidecar unreachable: return a structured retryable routing-unavailable error and keep native agents operational.
- Invalid sidecar response: return a sanitized 502 without leaking upstream bodies or secrets.
- OAuth callback failure: preserve the same-origin callback and safe `postMessage` behavior.
- Selected 9router model later disappears: keep the session value visible as unavailable and require another model selection before sending.
- Container restart: persistent volume preserves provider and OAuth configuration.

## Migration

Remove the bundled child-process supervisor and its package-resolution, port-allocation, crash-restart, and signal-handling code. Replace it with a bounded remote-sidecar health adapter.

Existing CloudCLI routing bindings and usage-alert data may remain in storage for compatibility, but are no longer read by the chat path or exposed in the new UI. Destructive database migration is unnecessary.

Preserve unrelated working-tree edits, including the user's current `NineRouterSettingsTab.tsx`, package files, and planning files, unless a required implementation change must be carefully merged into the same file.

## Verification

1. Contract tests prove CloudCLI validates and proxies official 9router REST responses.
2. RED-GREEN tests prove native models remain usable without a sidecar.
3. RED-GREEN tests prove 9router models appear in the unified selector and route messages through the REST data plane.
4. UI tests prove model-source and usage-estimate controls are absent.
5. Compose integration starts CloudCLI and official 9router with a persistent volume and no published sidecar port.
6. Real OAuth/provider setup and model discovery succeed through CloudCLI same-origin endpoints.
7. A real inference request succeeds with a selected 9router model.
8. Restarting the sidecar preserves configuration and native agents remain usable during sidecar downtime.
9. Full tests, typecheck, lint, production build, and both product Docker image builds pass.
