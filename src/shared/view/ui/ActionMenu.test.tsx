import assert from "node:assert/strict";
import test from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ActionMenu from "./ActionMenu.js";
import { getActionMenuPortalStyle } from "./actionMenuPosition.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("checked actions render as accessible switch-like menu items", () => {
	const markup = renderToStaticMarkup(
		createElement(ActionMenu, {
			label: "Account options",
			defaultOpen: true,
			items: [
				{
					key: "enabled",
					label: "Account enabled",
					checked: true,
					onSelect: () => {},
				},
			],
		}),
	);

	assert.match(markup, /role="menuitemcheckbox"/);
	assert.match(markup, /aria-checked="true"/);
	assert.match(markup, /Account enabled/);
});

test("portal menus render above the settings modal", () => {
	const style = getActionMenuPortalStyle({
		triggerRect: { bottom: 120, right: 300, top: 80 },
		viewportHeight: 800,
		viewportWidth: 1200,
		estimatedHeight: 100,
	});

	assert.deepEqual(style, { top: 126, left: 40, zIndex: 10_000 });
	assert.ok(Number(style.zIndex) > 9_999);
});
