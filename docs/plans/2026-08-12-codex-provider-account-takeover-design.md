# Codex Account Management via Provider Router — Design

**Date:** 2026-08-12

## Goal

Fix Provider Router model discovery against the current upstream response and make **Agents → Codex → Account** render the Provider Router account manager directly.

## Design

- Accept the current provider-model response where the envelope owns `provider` and `connectionId`, while each model is OpenAI-compatible `{ id, object, owned_by }`.
- Keep compatibility with the older routed-model response. Model identifiers remain authoritative upstream IDs and are never synthesized.
- Extract a data-owning `ProviderAccountsManager` from the routing tab. It owns `useNineRouterSettings`, derives account detail state, and renders the existing `ProviderAccountsSection`.
- Render that same manager in both Provider Router settings and Agents → Codex → Account. No duplicate account state, Codex CLI auth card, or legacy provider-login modal is used for the Codex account screen.
- The Provider Router page retains its Codex apply action and all existing runtime alerts.

## Error Handling

The existing inline account loading/retry behavior remains authoritative. Invalid model rows still fail safely; only documented current and legacy shapes are accepted.

## Verification

- Backend regression test for OpenAI-compatible model rows.
- Frontend render test proving Codex account content is the Provider Router account manager, not the legacy Codex auth card.
- Routing/frontend targeted tests, typecheck, build, Docker rebuild, and authenticated runtime probe.
