import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const routingDirectory = path.resolve(moduleDirectory, "..");
const productionFiles = [
	"nine-router-client.ts",
	"nine-router-http.ts",
	"nine-router-sidecar.service.ts",
	"routing-runtime.service.ts",
	"routing-target-policy.ts",
	"routing.module.ts",
	"routing.service.ts",
];
const implementationNameInError =
	/["'`][^"'`\n]*(?:(?:error|failed|failure|unavailable|invalid|could not|cannot|unable)[^"'`\n]*9router|9router[^"'`\n]*(?:error|failed|failure|unavailable|invalid|could not|cannot|unable))[^"'`\n]*["'`]/gi;

test("user-facing routing errors use Router terminology", () => {
	for (const file of productionFiles) {
		const source = readFileSync(path.join(routingDirectory, file), "utf8");
		assert.deepEqual(source.match(implementationNameInError), null, file);
	}
});
