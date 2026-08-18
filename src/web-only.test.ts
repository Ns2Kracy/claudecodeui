import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const packageJsonPath = path.join(repositoryRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};

const desktopOnlyPaths = [
  "electron",
  ".github/workflows/desktop-macos-branch-build.yml",
  ".github/workflows/desktop-release.yml",
  ".github/workflows/desktop-windows-branch-build.yml",
  "scripts/release/build-server-bundle.js",
  "scripts/release/prepare-desktop-app.js",
];

for (const desktopOnlyPath of desktopOnlyPaths) {
  test(`web-only repository excludes ${desktopOnlyPath}`, () => {
    assert.equal(
      existsSync(path.join(repositoryRoot, desktopOnlyPath)),
      false,
      `Desktop-only path still exists: ${desktopOnlyPath}`,
    );
  });
}

test("package script names exclude desktop commands", () => {
  const scriptNames = Object.keys(packageJson.scripts ?? {});

  assert.equal(
    scriptNames.some((scriptName) => scriptName.startsWith("desktop")),
    false,
    "Package scripts must not start with desktop",
  );
});

test("package script command values exclude desktop entrypoints", () => {
  const scriptCommands = Object.values(packageJson.scripts ?? {}).join("\n");
  const desktopEntrypoints = [
    "electron",
    "electron-builder",
    "electron/",
    ".desktop-build",
    "prepare-desktop-app",
  ];

  assert.equal(
    desktopEntrypoints.some((entrypoint) =>
      scriptCommands.includes(entrypoint),
    ),
    false,
    "Package script commands must not reference desktop entrypoints",
  );
});

test("package scripts exclude server:bundle", () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      packageJson.scripts ?? {},
      "server:bundle",
    ),
    false,
    "Package scripts must not define server:bundle",
  );
});

test("package excludes the top-level build configuration", () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(packageJson, "build"),
    false,
    "package.json must not define a top-level build configuration",
  );
});

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

for (const dependencySection of dependencySections) {
  for (const dependencyName of ["electron", "electron-builder"]) {
    test(`${dependencySection} exclude ${dependencyName}`, () => {
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          packageJson[dependencySection] ?? {},
          dependencyName,
        ),
        false,
        `${dependencySection} must not include ${dependencyName}`,
      );
    });
  }
}

test("web push hook excludes the desktop notification bridge", () => {
  const source = readFileSync(
    path.join(repositoryRoot, "src/hooks/useWebPush.ts"),
    "utf8",
  );

  assert.equal(
    source.includes("cloudcliDesktopNotifications"),
    false,
    "useWebPush.ts must not reference cloudcliDesktopNotifications",
  );
});

test("websocket server excludes the desktop notifications route", () => {
  const source = readFileSync(
    path.join(
      repositoryRoot,
      "server/modules/websocket/services/websocket-server.service.ts",
    ),
    "utf8",
  );

  assert.equal(
    source.includes("desktop-notifications"),
    false,
    "websocket-server.service.ts must not reference desktop-notifications",
  );
});
