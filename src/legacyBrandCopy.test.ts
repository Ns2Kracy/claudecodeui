import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

const LEGACY_BRAND_PATTERN =
	/9Router|Claude|Cursor|OpenCode|Provider Router|AI Assistant|AI Editor|Coding Assistant/;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function walk(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const filePath = path.join(root, entry.name);
		return entry.isDirectory() ? walk(filePath) : [filePath];
	});
}

function readLocaleFile(filePath: string): unknown {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch (error) {
		const detail = error instanceof Error ? `: ${error.message}` : "";
		throw new Error(`Could not parse locale file ${filePath}${detail}`);
	}
}

function collectLocaleCopy(value: unknown, keyPath = ""): string[] {
	if (typeof value === "string") {
		return LEGACY_BRAND_PATTERN.test(value) ? [`${keyPath}: ${value}`] : [];
	}
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, nested]) =>
		collectLocaleCopy(nested, keyPath ? `${keyPath}.${key}` : key),
	);
}

function collectSourceCopy(filePath: string): string[] {
	if (filePath.endsWith("legacyBrandCopy.test.ts")) return [];
	if (/\.(?:test|spec)\.[jt]sx?$/.test(filePath)) return [];
	const source = readFileSync(filePath, "utf8");
	const scriptKind = filePath.endsWith(".tsx")
		? ts.ScriptKind.TSX
		: filePath.endsWith(".ts")
			? ts.ScriptKind.TS
			: filePath.endsWith(".jsx")
				? ts.ScriptKind.JSX
				: ts.ScriptKind.JS;
	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKind,
	);
	const matches: string[] = [];
	function visit(node: ts.Node): void {
		const copyNode =
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isJsxText(node);
		if (
			copyNode &&
			LEGACY_BRAND_PATTERN.test(node.text) &&
			!/^[-\w.]+$/.test(node.text)
		) {
			const { line } = sourceFile.getLineAndCharacterOfPosition(
				node.getStart(sourceFile),
			);
			matches.push(`${filePath}:${line + 1}: ${node.text}`);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return matches;
}

test("user-facing copy does not expose retired provider brands", () => {
	const projectRoot = process.cwd();
	const localeMatches = walk(path.join(projectRoot, "src/i18n/locales"))
		.filter((filePath) => filePath.endsWith(".json"))
		.flatMap((filePath) =>
			collectLocaleCopy(readLocaleFile(filePath)).map(
				(match) => `${filePath}: ${match}`,
			),
		);
	const sourceMatches = ["src", "server", "shared"]
		.flatMap((directory) => walk(path.join(projectRoot, directory)))
		.filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)))
		.flatMap(collectSourceCopy);

	assert.deepEqual([...localeMatches, ...sourceMatches], []);
});
