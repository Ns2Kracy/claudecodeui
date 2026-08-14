import assert from "node:assert/strict";
import test from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { completeOnboardingSetup } from "./completeOnboardingSetup.js";
import Onboarding from "./Onboarding.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("onboarding hides Codex OAuth and keeps only Git setup", () => {
	const markup = renderToStaticMarkup(createElement(Onboarding));

	assert.match(markup, /Git Configuration/);
	assert.match(markup, /Complete Setup/);
	assert.equal(markup.includes("Connect Agents"), false);
	assert.equal(markup.includes("OpenAI Codex"), false);
	assert.equal(markup.includes("OAuth"), false);
});

test("onboarding saves Git configuration before completing setup", async () => {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	await completeOnboardingSetup("Ada", "ada@example.com", {
		fetch: async (url, init) => {
			calls.push({ url: String(url), init });
			return new Response(null, { status: 204 });
		},
	});

	assert.deepEqual(
		calls.map(({ url }) => url),
		["/api/user/git-config", "/api/user/complete-onboarding"],
	);
	assert.equal(
		calls[0]?.init?.body,
		JSON.stringify({ gitName: "Ada", gitEmail: "ada@example.com" }),
	);
});

test("onboarding does not complete when Git configuration fails", async () => {
	const calls: string[] = [];
	await assert.rejects(
		() =>
			completeOnboardingSetup("Ada", "ada@example.com", {
				fetch: async (url) => {
					calls.push(String(url));
					return new Response(JSON.stringify({ error: "Git save failed" }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				},
			}),
		/Git save failed/,
	);
	assert.deepEqual(calls, ["/api/user/git-config"]);
});
