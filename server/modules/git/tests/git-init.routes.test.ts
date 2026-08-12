import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";

import express from "express";

import { createGitRouter } from "@/modules/git/git.routes.js";

type GitDependencies = Parameters<typeof createGitRouter>[0];

function createSpawnProcess(
	outputByCommand: (args: readonly string[]) => string,
): GitDependencies["spawnProcess"] {
	return ((_command: string, args: readonly string[]) => {
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		process.nextTick(() => {
			child.stdout.end(outputByCommand(args));
			child.emit("close", 0);
		});
		return child;
	}) as unknown as GitDependencies["spawnProcess"];
}

async function withGitServer(
	dependencies: GitDependencies,
	run: (baseUrl: string) => Promise<void>,
): Promise<void> {
	const app = express();
	app.use(express.json());
	app.use("/api/git", createGitRouter(dependencies));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address() as AddressInfo;
		await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

test("git init does not run when repository validation fails for an execution error", async () => {
	const commands: string[][] = [];
	const spawnProcess = ((_command: string, args: string[]) => {
		commands.push(args);
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		process.nextTick(() =>
			child.emit(
				"error",
				Object.assign(new Error("permission denied"), {
					code: "EACCES",
				}),
			),
		);
		return child;
	}) as GitDependencies["spawnProcess"];
	const router = createGitRouter({
		fileSystem: {
			access: async () => undefined,
		} as unknown as GitDependencies["fileSystem"],
		spawnProcess,
		resolveProjectPathById: () => "/workspace/repo",
		queryCodex: async () => {
			throw new Error("unexpected Codex call");
		},
	});
	const app = express();
	app.use(express.json());
	app.use("/api/git", router);
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");

	try {
		const address = server.address() as AddressInfo;
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/git/init`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ project: "project-1" }),
			},
		);
		const body = (await response.json()) as { success: boolean; error: string };
		assert.equal(body.success, false);
		assert.match(body.error, /permission denied/);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	assert.deepEqual(commands, [["rev-parse", "--is-inside-work-tree"]]);
});

test("commit-message generation always invokes Codex and collects normalized text", async () => {
	let invoked = false;
	await withGitServer(
		{
			fileSystem: {
				access: async () => undefined,
			} as unknown as GitDependencies["fileSystem"],
			spawnProcess: createSpawnProcess((args) => {
				if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
					return "true\n";
				}
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
					return `${process.cwd()}\n`;
				}
				if (args[0] === "diff") {
					return "diff --git a/file.ts b/file.ts\n+const value = 1;\n";
				}
				return "";
			}),
			resolveProjectPathById: () => process.cwd(),
			queryCodex: async (_prompt, options, writer) => {
				invoked = true;
				assert.equal(options.permissionMode, "bypassPermissions");
				writer.send({
					id: "msg-1",
					sessionId: "",
					timestamp: new Date().toISOString(),
					provider: "codex",
					kind: "text",
					role: "assistant",
					content: "feat(git): generate messages with codex",
				});
			},
		},
		async (baseUrl) => {
			const response = await fetch(
				`${baseUrl}/api/git/generate-commit-message`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						project: "project-1",
						files: ["file.ts"],
						provider: "claude",
					}),
				},
			);
			const body = (await response.json()) as { message: string };

			assert.equal(response.status, 200);
			assert.equal(body.message, "feat(git): generate messages with codex");
		},
	);

	assert.equal(invoked, true);
});
