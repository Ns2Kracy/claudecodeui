# Codex Account Management via Provider Router — Design

**Date:** 2026-08-12

## Goal

Fix Provider Router model discovery against the current upstream response and make **Agents → Codex → Account** render the Provider Router account manager directly.

## Design

- Accept the current provider-model response where the envelope owns `provider` and `connectionId`, while each model is OpenAI-compatible `{ id, object, owned_by }`.
- Keep compatibility with the older routed-model response. Model identifiers remain authoritative upstream IDs and are never synthesized.
- Extract a data-owning `ProviderAccountsManager` from the routing tab. It owns `useNineRouterSettings`, derives account detail state, and renders the existing `ProviderAccountsSection`.
- Render the account manager in Agents → Codex → Account. No duplicate Provider Router settings page, Codex CLI auth card, or legacy provider-login modal remains.
- Codex uses the routing layer directly; there is no manual “Apply to Codex” action.

## Error Handling

The existing inline account loading/retry behavior remains authoritative. Invalid model rows still fail safely; only documented current and legacy shapes are accepted.

## Verification

- Backend regression test for OpenAI-compatible model rows.
- Frontend render test proving Codex account content is the Provider Router account manager, not the legacy Codex auth card.
- Routing/frontend targeted tests, typecheck, build, Docker rebuild, and authenticated runtime probe.
