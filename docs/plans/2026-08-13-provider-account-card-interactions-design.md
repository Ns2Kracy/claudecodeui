# Provider Account Card Interaction Design

**Date:** 2026-08-13

## Goal

Reduce account-card action clutter, make account state semantics explicit, and provide visible account-test progress and outcomes.

## Information hierarchy

Each account row presents three labeled facts instead of competing badges:

- **Connection status:** Enabled or Disabled. This is neutral operational state.
- **Health status:** Healthy, Not tested, Cooling down, Limited, or Failed. This alone receives semantic success/warning/error color.
- **Authentication:** OAuth or API key. This remains neutral metadata.

Provider name, model count, and priority remain secondary metadata.

## Actions

The only persistent primary action is **Test**. A compact **More** (`···`) action menu contains:

- an enabled-state control represented as a switch,
- Edit for API-key accounts,
- Delete account as a separated destructive item.

Selecting the switch to disable an active account does not mutate immediately. It opens an inline confirmation explaining that the account’s models will no longer be used for new requests while existing sessions are unaffected. Cancel preserves the active state; Confirm disable sends the update. Enabling an inactive account is immediate because it is non-destructive.

Deletion keeps the existing inline irreversible-action confirmation.

## Test feedback

Test is account-local:

- while running, its button shows a spinner and “Testing”;
- completion stores elapsed client-observed milliseconds and the server result;
- success displays “Test successful · N ms”;
- failure displays “Test failed · N ms” plus the returned reason;
- “View details” reveals timestamp, duration, health result, credential-refresh result, and complete error reason;
- the result container uses `aria-live="polite"`.

Transport failures continue through the existing global mutation error handling and are also summarized locally when possible.

## Accessibility

Use the existing `ActionMenu` for Escape, outside-click, focus restoration, and menu semantics. The switch exposes `role="switch"` and `aria-checked`. Inline confirmations use `role="alert"`; test results use `role="status"`/`aria-live`. All controls retain visible focus treatment from shared UI primitives.

## Scope

Frontend only. The existing account-test API already returns `healthy`, `error`, and `refreshed`; elapsed time and timestamp are measured in the UI. No backend/API change is required.
