import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMainTab } from "./useSettingsController.js";

test("legacy settings tabs migrate to the Agents account surface", () => {
	assert.equal(normalizeMainTab("routing"), "agents");
	assert.equal(normalizeMainTab("tools"), "agents");
	assert.equal(normalizeMainTab("appearance"), "appearance");
	assert.equal(normalizeMainTab("about"), "agents");
	assert.equal(normalizeMainTab("unknown"), "agents");
});
