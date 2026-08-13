# Codex Provider Accounts Experience — Design

**Date:** 2026-08-13

## Goal

Replace the confusing provider-account surface under **Agents → Codex → Account** with a single task-oriented experience for connecting Codex OAuth, popular API-key providers, OpenAI-compatible endpoints, and managing connected accounts.

## User Experience

The account surface has two authentication paths followed by one account list:

1. **Codex OAuth** is the primary path. It uses the Codex mark, explains that ChatGPT authorization is owned by 9Router, and offers one prominent “Continue with ChatGPT” action.
2. **API Key authentication** contains six equal provider choices: OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, and OpenAI Compatible. Selecting any choice reveals the same account-name, editable Base URL, and write-only API-key form. Presets start with their official compatible endpoint; OpenAI Compatible starts blank. Prefix, API type, and optional model ID remain advanced fields where applicable. Saving creates a provider node for the chosen endpoint and then attaches the API-key account to that node.
3. **Connected accounts** is one compact list. Each row includes provider identity, account name, health, authentication type, model count, and available test/edit/enable/delete actions. There is no duplicate generic add form.

## Interaction Model

- Connection choices use inline progressive disclosure rather than nested cards or a modal.
- Switching choices clears transient errors and secret inputs.
- Connection, validation, loading, empty, and failure states are announced with semantic status/alert roles.
- All controls use existing CloudCLI semantic colors, spacing, button, input, and focus styles.
- The layout remains one column on narrow screens; provider choices wrap without horizontal scrolling.

## Data Flow

- API-key choices create standard 9Router provider accounts using upstream provider IDs: `openai`, `anthropic`, `gemini`, `deepseek`, and `openrouter`.
- OpenAI Compatible validates the endpoint, creates a provider node, then refreshes account/model details. Credentials remain write-only and are never echoed into account views.
- Codex OAuth uses the existing same-origin routing facade and 9Router’s Codex OAuth endpoints. Because upstream Codex authorization binds to its localhost callback contract, the backend must provide a bounded callback handoff rather than falsely treating the normal CloudCLI browser callback as supported.
- Account mutations continue through `useNineRouterSettings`; the visual connection surface calls the existing routing API and refreshes details after a successful connection.

## Error Handling

- Unsafe authorization URLs remain blocked.
- Popup-blocking, expired OAuth transactions, provider validation failures, offline runtime, and upstream load errors remain visible inline with a retry action where useful.
- API keys are cleared when a flow is cancelled or succeeds.
- Destructive account deletion keeps an explicit confirmation step.

## Verification

- Catalog tests assert the five quick API-key provider IDs and Codex OAuth profile.
- Frontend server-render tests assert hierarchy, icons/accessibility labels, progressive disclosure, custom advanced fields, connected-account model counts, and removal of the duplicate generic add form.
- Backend OAuth tests assert the Codex callback bridge contract and transaction isolation without exposing verifier/token data.
- Run targeted routing/settings tests, typecheck, lint touched files, production build, Docker rebuild, authenticated routing probe, and real-browser visual/interaction checks at desktop and mobile widths.
