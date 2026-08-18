# Codex Client Event Presentation Design

**Date:** 2026-08-18

## Goal

Match the official Codex client’s event semantics in the web chat: final answers remain the primary conversation, tool work remains compact activity, and Codex reasoning summaries are filtered and rendered as low-emphasis execution context instead of a prominent “thinking” transcript.

## Source behavior

The official Codex TUI consumes reasoning-summary events separately from raw reasoning, extracts a leading bold summary heading for active status, removes empty `<!-- -->` placeholders, keeps unstructured prose transcript-only unless detailed reasoning is enabled, renders retained summaries as dim italic bullets, and treats the last agent message as the final response.

The SDK already exposes structured reasoning, tool, and agent-message events. The backend already withholds commentary and publishes only the final agent message. The missing behavior is primarily frontend filtering and hierarchy.

## Design

Introduce a pure Codex reasoning-summary parser and display policy. It recognizes a leading `**Heading**`, removes placeholder-only parts, and classifies plain unstructured reasoning as transcript-only. Apply the policy before grouping and message-key generation so invisible reasoning cannot split tool runs or alter avatar grouping.

Codex summaries that survive filtering appear as compact muted italic bullets. They are not brain-icon cards, are not labelled as chain-of-thought, and have no copy control. Other providers retain their existing reasoning behavior.

When a live Codex summary contains a leading bold heading, that heading updates the existing activity indicator. The full reasoning body is not promoted into status.

`showThinking` becomes an advanced detailed-reasoning preference and defaults off. Normal exports use the same visible-message policy.

## Compatibility

No provider protocol or transcript migration. Existing commentary/final-answer backend filtering remains intact, and stored reasoning is reclassified at render time.

## Verification

Pure policy tests, component source regression, existing Codex provider tests, typecheck, lint, build, and browser verification when an authenticated runtime is available.
