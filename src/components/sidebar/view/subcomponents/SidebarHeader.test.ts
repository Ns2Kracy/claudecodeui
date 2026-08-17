import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarHeaderSource = readFileSync(
	new URL("./SidebarHeader.tsx", import.meta.url),
	"utf8",
);

test("sidebar header omits the GitHub star promotion", () => {
	assert.equal(sidebarHeaderSource.includes("GitHubStarBadge"), false);
	assert.equal(sidebarHeaderSource.includes("api.github.com"), false);
});
