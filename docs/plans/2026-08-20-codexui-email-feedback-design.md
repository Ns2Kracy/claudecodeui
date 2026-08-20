# CodexUI Email Feedback Design

## Goal

Make the command-menu button quieter by removing its visual hover tooltip, and replace the sidebar issue-report destination with direct email contact.

## Design

- Remove the `showAllCommands` tooltip from the command-menu trigger in `ChatComposer`.
- Keep an `aria-label` so the icon-only control remains accessible.
- Replace expanded sidebar “Report Issue” text with `ningkun@icewhale.org`.
- Use `mailto:ningkun@icewhale.org?subject=CodexUI%20Issue` for expanded, mobile, and collapsed sidebar feedback links.
- Use the native mail client integration; add no dependency or custom email UI.

## Verification

Static component regression tests verify the tooltip removal, accessible label, email text, and exact mailto subject. Run targeted tests, type checking, and the client build.
