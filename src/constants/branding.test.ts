import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const collectStringValues = (value: unknown): string[] => {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStringValues);
	if (value && typeof value === "object") {
		return Object.values(value).flatMap(collectStringValues);
	}
	return [];
};

test("user-visible branding is CodexUI while internal CloudCLI identifiers stay compatible", () => {
	const indexHtml = read("index.html");
	assert.match(indexHtml, /<title>CodexUI<\/title>/);
	assert.match(indexHtml, /apple-mobile-web-app-title" content="CodexUI"/);

	const manifest = JSON.parse(read("public/manifest.json"));
	assert.equal(manifest.name, "CodexUI");
	assert.equal(manifest.short_name, "CodexUI");
	assert.equal(manifest.description, "CodexUI web application");

	const visibleFiles = [
		"public/api-docs.html",
		"public/clear-cache.html",
		"public/sw.js",
		"src/components/auth/view/AuthLoadingScreen.tsx",
		"src/components/auth/view/AuthScreenLayout.tsx",
		"src/components/auth/view/LoginForm.tsx",
		"src/components/auth/view/SetupForm.tsx",
		"src/components/mcp/view/McpServers.tsx",
		"src/components/settings/view/PremiumFeatureCard.tsx",
		"src/components/settings/view/tabs/api-settings/sections/VersionInfoSection.tsx",
		"src/components/settings/view/tabs/nine-router-settings/ProviderConnectionDialog.tsx",
		"src/components/sidebar/view/subcomponents/SidebarFooter.tsx",
		"src/components/sidebar/view/subcomponents/SidebarProjectList.tsx",
		"src/utils/pageTitleNotification.ts",
	];

	for (const path of visibleFiles) {
		const source = read(path)
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		const visibleCloudCliLiterals =
			source.match(/["'`]([^"'`]*CloudCLI[^"'`]*)["'`]/g) ?? [];
		const allowedInternalLiterals = visibleCloudCliLiterals.filter(
			(literal) =>
				literal.includes("cloudcli.ai") ||
				literal.includes("cloudcli-") ||
				(path.endsWith("SidebarFooter.tsx") &&
					literal.includes("Powered by CloudCLI")),
		);
		assert.deepEqual(
			visibleCloudCliLiterals,
			allowedInternalLiterals,
			`${path} still contains a user-visible CloudCLI literal`,
		);
	}

	const localesRoot = "src/i18n/locales";
	for (const locale of readdirSync(localesRoot)) {
		for (const file of readdirSync(join(localesRoot, locale)).filter((name) =>
			name.endsWith(".json"),
		)) {
			const values = collectStringValues(
				JSON.parse(read(join(localesRoot, locale, file))),
			);
			assert.equal(
				values.some((value) => value.includes("CloudCLI")),
				false,
				`${locale}/${file} still exposes the old product name`,
			);
		}
	}

	assert.equal(JSON.parse(read("package.json")).name, "@cloudcli-ai/cloudcli");
});
