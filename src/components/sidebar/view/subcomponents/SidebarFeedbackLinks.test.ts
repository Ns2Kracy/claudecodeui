import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const footerSource = readFileSync(
	new URL("./SidebarFooter.tsx", import.meta.url),
	"utf8",
);
const collapsedSource = readFileSync(
	new URL("./SidebarCollapsed.tsx", import.meta.url),
	"utf8",
);

const feedbackEmail = "ningkun@icewhale.org";
const feedbackHref = "mailto:ningkun@icewhale.org?subject=CodexUI%20Issue";

function feedbackAnchors(source: string): string[] {
	return source.match(/<a\s+href=\{FEEDBACK_HREF\}[\s\S]*?<\/a>/g) ?? [];
}

test("desktop, mobile, and collapsed feedback anchors open the CodexUI email", () => {
	assert.ok(footerSource.includes(feedbackEmail));
	assert.ok(footerSource.includes(feedbackHref));
	assert.ok(collapsedSource.includes(feedbackEmail));
	assert.ok(collapsedSource.includes(feedbackHref));
	assert.doesNotMatch(footerSource, /community\.zimaspace\.com/);
	assert.doesNotMatch(collapsedSource, /community\.zimaspace\.com/);

	const expandedLinks = feedbackAnchors(footerSource);
	assert.equal(expandedLinks.length, 2);
	for (const link of expandedLinks) {
		assert.match(link, /\{FEEDBACK_EMAIL\}/);
	}

	const collapsedLinks = feedbackAnchors(collapsedSource);
	assert.equal(collapsedLinks.length, 1);
	assert.match(collapsedLinks[0], /aria-label=\{FEEDBACK_EMAIL\}/);
	assert.match(collapsedLinks[0], /title=\{FEEDBACK_EMAIL\}/);
});
