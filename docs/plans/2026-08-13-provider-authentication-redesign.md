# Provider Authentication Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Present Codex OAuth and API Key authentication as the only two connection categories, with six peer API-key providers, editable endpoints, and recognizable local brand icons.

**Architecture:** Keep OAuth unchanged. Represent every API-key choice as a provider profile with a default Base URL and compatible provider-node metadata. The browser validates the endpoint, creates the 9Router provider node, then creates the API-key account against the returned node ID. Brand images are bundled under `public/icons/providers` and rendered through the existing `ProviderIcon` boundary.

**Tech Stack:** React, TypeScript, Node test runner, existing CloudCLI routing API.

---

### Task 1: Define the catalog contract

- Modify `src/components/settings/view/tabs/nine-router-settings/ProviderCatalog.ts`.
- Update `ProviderConnectionDialog.test.tsx` first to require one OAuth profile and six `api_key` profiles with default endpoint metadata.
- Run the targeted test and confirm RED, then implement the profile metadata.

### Task 2: Unify the API-key editor and persistence flow

- Modify `ProviderConnectionDialog.tsx`, `CustomProviderEditor.tsx`, and `ProviderConnections.tsx`.
- Render Name, Base URL, and API key for every API-key profile.
- Validate the endpoint, create a provider node, then create its account using the returned node ID.
- Keep API type, prefix, and optional model ID under advanced settings.
- Run targeted UI/API tests and typecheck.

### Task 3: Replace letter avatars

- Add local provider images under `public/icons/providers/`.
- Modify `ProviderIcon.tsx` to render those assets with accessible labels and retain the existing Codex SVG.
- Add SSR tests proving provider identities render images rather than letter text.

### Task 4: Verify and deploy

- Run touched-file ESLint, full tests, typecheck, and production build.
- Rebuild the Docker service and confirm its bundle contains the new category text and provider assets.
