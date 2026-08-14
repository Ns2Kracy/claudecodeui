import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Codex model lookup does not replace a missing cache with hard-coded models", async () => {
	const tempHome = await mkdtemp(
		path.join(os.tmpdir(), "cloudcli-codex-models-"),
	);
	const originalHome = process.env.HOME;

	try {
		process.env.HOME = tempHome;
		const codexDirectory = path.join(tempHome, ".codex");
		const cachePath = path.join(codexDirectory, "models_cache.json");
		await mkdir(codexDirectory, { recursive: true });
		await writeFile(
			cachePath,
			JSON.stringify({
				models: [
					{
						slug: "configured-model",
						display_name: "Configured model",
						visibility: "list",
						priority: 1,
					},
				],
			}),
			"utf8",
		);

		const { CodexProviderModels } = await import(
			"../list/codex/codex-models.provider.js"
		);
		const provider = new CodexProviderModels();
		const configuredCatalog = await provider.getSupportedModels();
		assert.equal(configuredCatalog.DEFAULT, "configured-model");
		assert.deepEqual(
			configuredCatalog.OPTIONS.map((option) => option.value),
			["configured-model"],
		);

		await unlink(cachePath);
		assert.deepEqual(await provider.getSupportedModels(), {
			OPTIONS: [],
			DEFAULT: "",
		});
		assert.deepEqual(await provider.getCurrentActiveModel(), { model: "" });
	} finally {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await rm(tempHome, { recursive: true, force: true });
	}
});
