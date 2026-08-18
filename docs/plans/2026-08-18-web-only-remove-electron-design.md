# Web-only application design

## Goal

Remove the Electron desktop application and leave CloudCLI as a web application with its existing Node.js server and CLI. Browser desktop layouts and Web Push remain supported.

## Scope

- Delete the complete `electron/` application.
- Delete desktop packaging and desktop release workflows.
- Remove Electron launch, staging, packaging, distribution, icon-generation scripts, and electron-builder configuration.
- Remove Electron-only dependencies and package publication entries.
- Remove renderer bridges and settings behavior that only exist inside Electron.
- Remove or update tests that require Electron bridge symbols.
- Remove desktop-build ignore rules and release-script branches that no longer serve Web releases.

## Preserved behavior

- Responsive browser layouts, including desktop-width layouts.
- The Vite web client and Node.js server.
- Browser Web Push notifications.
- Server bundling, npm packaging, Docker deployment, and the CLI.
- Existing unrelated uncommitted dependency changes in `package.json` and `package-lock.json`.

## Implementation approach

Perform one complete removal rather than leaving disabled desktop code. Update package metadata first, regenerate the lockfile using the current manifest, remove dedicated Electron files and workflows, then simplify frontend notification code to the browser-only path. Search the tracked repository for Electron entry points, bridge globals, desktop build commands, and packaging artifacts to catch orphaned references.

## Verification

- Repository search finds no Electron imports, bridge globals, desktop packaging commands, or Electron build workflows.
- `npm install --package-lock-only` produces a lockfile without Electron and electron-builder packages.
- Frontend and backend typechecks pass.
- Tests and lint pass.
- Web client and server builds pass.
- A production web server starts and serves the built application.
