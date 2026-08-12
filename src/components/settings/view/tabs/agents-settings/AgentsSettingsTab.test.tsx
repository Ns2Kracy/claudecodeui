import assert from "node:assert/strict";
import test from "node:test";

import { SETTINGS_AGENTS } from "./agentsSettingsState.js";

test("agent settings exposes only Codex", () => {
	assert.deepEqual(SETTINGS_AGENTS, ["codex"]);
});
