import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerSource = readFileSync(
	new URL("./ChatComposer.tsx", import.meta.url),
	"utf8",
);
const modelMenuSource = readFileSync(
	new URL("./ComposerModelMenu.tsx", import.meta.url),
	"utf8",
);
const tokenUsageSource = readFileSync(
	new URL("./TokenUsageSummary.tsx", import.meta.url),
	"utf8",
);
const appStyles = readFileSync(
	new URL("../../../../index.css", import.meta.url),
	"utf8",
);

test("composer footer stays on one line and progressively hides secondary text", () => {
	assert.match(composerSource, /chat-composer-container/);
	assert.match(composerSource, /chat-composer-footer/);
	assert.match(composerSource, /chat-composer-tools/);
	assert.match(composerSource, /chat-composer-submit-hint/);
	assert.doesNotMatch(composerSource, /chat-composer-submit-hint[^"`]*lg:block/);
	assert.match(composerSource, /chat-composer-actions/);
	assert.match(composerSource, /chat-composer-clear/);
	assert.match(tokenUsageSource, /chat-composer-token-label/);
	assert.match(
		modelMenuSource,
		/chat-composer-model-trigger[^"\n]*min-w-0[^"\n]*shrink/,
	);
	assert.match(composerSource, /chat-composer-tools[^"\n]*shrink-0/);
	assert.match(composerSource, /chat-composer-actions[^"\n]*min-w-0[^"\n]*grow/);

	assert.match(appStyles, /container-name:\s*chat-composer/);
	assert.match(
		appStyles,
		/\.chat-composer-footer,[\s\S]*?\.chat-composer-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap/,
	);
	assert.doesNotMatch(
		appStyles,
		/\.chat-composer-tools\s*\{[\s\S]*?flex-wrap:\s*wrap/,
	);
	assert.match(
		appStyles,
		/@container chat-composer \(max-width:\s*48rem\)[\s\S]*?\.chat-composer-submit-hint\s*\{[\s\S]*?display:\s*none(?:\s*!important)?/,
	);
	assert.match(
		appStyles,
		/@container chat-composer \(max-width:\s*36rem\)[\s\S]*?\.chat-composer-clear[\s\S]*?display:\s*none(?:\s*!important)?/,
	);
	assert.match(
		appStyles,
		/@container chat-composer \(max-width:\s*30rem\)[\s\S]*?\.chat-composer-token-label[\s\S]*?display:\s*none(?:\s*!important)?/,
	);
	assert.match(
		appStyles,
		/@container chat-composer \(max-width:\s*24rem\)[\s\S]*?\.chat-composer-model-trigger[\s\S]*?display:\s*none(?:\s*!important)?/,
	);
});

test("command menu trigger uses an accessible label without a hover tooltip", () => {
	assert.doesNotMatch(
		composerSource,
		/tooltip=\{\{ content: t\("input\.showAllCommands"\) \}\}/,
	);
	assert.match(composerSource, /aria-label=\{t\("input\.showAllCommands"\)\}/);
});
