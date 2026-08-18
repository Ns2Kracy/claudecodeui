import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageComponentSource = readFileSync(
	new URL("./MessageComponent.tsx", import.meta.url),
	"utf8",
);
test("user copy and time metadata render below the text bubble", () => {
	const bubbleMarker = 'data-user-message-bubble="true"';
	const metadataMarker = 'data-user-message-metadata="true"';
	const bubbleStart = messageComponentSource.indexOf(bubbleMarker);
	const metadataStart = messageComponentSource.indexOf(metadataMarker);
	const bubbleClose = messageComponentSource.indexOf("</div>", bubbleStart);

	assert.notEqual(bubbleStart, -1, "the user text bubble must be identifiable");
	assert.notEqual(
		metadataStart,
		-1,
		"the user metadata row must be identifiable",
	);
	assert.ok(
		metadataStart > bubbleClose,
		"the user metadata row must be outside and after the text bubble",
	);

	const metadataTag = messageComponentSource.slice(
		messageComponentSource.lastIndexOf("<div", metadataStart),
		messageComponentSource.indexOf(">", metadataStart) + 1,
	);
	assert.match(metadataTag, /-mt-1/);
	assert.match(metadataTag, /justify-end/);
	assert.match(metadataTag, /text-muted-foreground/);
	assert.match(metadataTag, /\[&_button\]:text-gray-400/);
});

test("Codex reasoning uses the compact summary treatment instead of a thinking card", () => {
	assert.match(messageComponentSource, /data-codex-reasoning-summary="true"/);
	assert.match(messageComponentSource, /italic/);
	assert.doesNotMatch(
		messageComponentSource,
		/Thinking messages — Reasoning component/,
	);
});
