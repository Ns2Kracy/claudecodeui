import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import TOML from "@iarna/toml";

import { AppError } from "@/shared/utils.js";

import { applyCustomCodexProvider } from "./codex-custom-provider-config.js";

async function withTempConfig(
	run: (configPath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "codex-custom-provider-"));
	const configPath = path.join(root, ".codex", "config.toml");
	try {
		await run(configPath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("creates a private Codex config with the Custom provider without selecting it", async () => {
	await withTempConfig(async (configPath) => {
		const result = await applyCustomCodexProvider({
			configPath,
			baseUrl: "http://127.0.0.1:20128/api/v1",
			apiKey: "router-key",
		});

		const parsed = TOML.parse(await readFile(configPath, "utf8")) as Record<
			string,
			unknown
		>;
		const providers = parsed.model_providers as Record<string, unknown>;
		assert.deepEqual(providers.Custom, {
			name: "Custom",
			base_url: "http://127.0.0.1:20128/api/v1",
			wire_api: "responses",
			experimental_bearer_token: "router-key",
		});
		assert.equal(parsed.model_provider, undefined);
		assert.equal(parsed.model, undefined);
		assert.deepEqual(result, { provider: "Custom" });
		assert.equal((await stat(configPath)).mode & 0o777, 0o600);
	});
});

test("preserves Codex defaults, other providers, and unmanaged Custom fields while updating managed fields", async () => {
	await withTempConfig(async (configPath) => {
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(
			configPath,
			[
				'model = "gpt-existing"',
				'model_provider = "Existing"',
				"",
				"[model_providers.Existing]",
				'name = "Existing"',
				'base_url = "https://existing.example/v1"',
				"",
				"[model_providers.Custom]",
				'name = "Old name"',
				'base_url = "https://old.example/v1"',
				'wire_api = "chat"',
				'experimental_bearer_token = "old-key"',
				"request_max_retries = 7",
				"",
			].join("\n"),
			"utf8",
		);

		await applyCustomCodexProvider({
			configPath,
			baseUrl: "https://router.example/api/v1",
			apiKey: "new-key",
		});
		await applyCustomCodexProvider({
			configPath,
			baseUrl: "https://router-2.example/api/v1",
			apiKey: "newer-key",
		});

		const parsed = TOML.parse(await readFile(configPath, "utf8")) as Record<
			string,
			unknown
		>;
		assert.equal(parsed.model, "gpt-existing");
		assert.equal(parsed.model_provider, "Existing");
		const providers = parsed.model_providers as Record<
			string,
			Record<string, unknown>
		>;
		assert.equal(providers.Existing?.base_url, "https://existing.example/v1");
		assert.deepEqual(providers.Custom, {
			name: "Custom",
			base_url: "https://router-2.example/api/v1",
			wire_api: "responses",
			experimental_bearer_token: "newer-key",
			request_max_retries: 7,
		});
	});
});

test("rejects invalid TOML without replacing the original config", async () => {
	await withTempConfig(async (configPath) => {
		await mkdir(path.dirname(configPath), { recursive: true });
		const original = "[model_providers.Custom\ninvalid";
		await writeFile(configPath, original, "utf8");

		await assert.rejects(
			applyCustomCodexProvider({
				configPath,
				baseUrl: "https://router.example/api/v1",
				apiKey: "secret-key",
			}),
			(error: unknown) =>
				error instanceof AppError &&
				error.code === "CODEX_CONFIG_INVALID" &&
				error.statusCode === 409 &&
				!error.message.includes("secret-key"),
		);
		assert.equal(await readFile(configPath, "utf8"), original);
	});
});
