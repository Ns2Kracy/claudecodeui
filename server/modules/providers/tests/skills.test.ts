import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { providerSkillsService } from "@/modules/providers/services/skills.service.js";

const patchHomeDir = (nextHomeDir: string) => {
	const original = os.homedir;
	(os as any).homedir = () => nextHomeDir;
	return () => {
		(os as any).homedir = original;
	};
};

const writeSkill = async (
	skillsRoot: string,
	directoryName: string,
	name: string,
	description: string,
): Promise<string> => {
	const skillDir = path.join(skillsRoot, directoryName);
	await fs.mkdir(skillDir, { recursive: true });
	const skillPath = path.join(skillDir, "SKILL.md");
	await fs.writeFile(
		skillPath,
		`---\nname: ${name}\ndescription: ${description}\n---\n\n`,
		"utf8",
	);
	return skillPath;
};

/**
 * Covers every active Codex skill root and repository lookup from cwd through
 * parent directories to the git root.
 */
test("providerSkillsService lists codex repository, user, and system skills", {
	concurrency: false,
}, async () => {
	const tempRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "llm-skills-codex-"),
	);
	const repoRoot = path.join(tempRoot, "repo");
	const workspacePath = path.join(repoRoot, "packages", "app");
	await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
	await fs.mkdir(workspacePath, { recursive: true });

	const restoreHomeDir = patchHomeDir(tempRoot);
	try {
		await writeSkill(
			path.join(workspacePath, ".agents", "skills"),
			"cwd-dir",
			"codex-cwd",
			"Cwd skill",
		);
		await writeSkill(
			path.join(repoRoot, "packages", ".agents", "skills"),
			"parent-dir",
			"codex-parent",
			"Parent skill",
		);
		await writeSkill(
			path.join(repoRoot, ".agents", "skills"),
			"root-dir",
			"codex-root",
			"Root skill",
		);
		await writeSkill(
			path.join(tempRoot, ".agents", "skills"),
			"user-dir",
			"codex-user",
			"User skill",
		);
		await writeSkill(
			path.join(tempRoot, ".codex", "skills"),
			"home-dir",
			"codex-home-user",
			"Home skill",
		);
		await writeSkill(
			path.join(tempRoot, ".codex", "skills", ".system"),
			"system-dir",
			"codex-system",
			"System skill",
		);

		const skills = await providerSkillsService.listProviderSkills("codex", {
			workspacePath,
		});
		const byName = new Map(skills.map((skill) => [skill.name, skill]));

		assert.equal(byName.get("codex-cwd")?.scope, "repo");
		assert.equal(byName.get("codex-parent")?.scope, "repo");
		assert.equal(byName.get("codex-root")?.scope, "repo");
		assert.equal(byName.get("codex-user")?.scope, "user");
		assert.equal(byName.get("codex-home-user")?.scope, "user");
		assert.equal(byName.get("codex-system")?.scope, "system");
		assert.equal(byName.get("codex-root")?.command, "$codex-root");
	} finally {
		restoreHomeDir();
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

/**
 * Covers managed Codex skill creation, supporting files, fallback naming,
 * replacement cleanup, batch validation, removal, and path traversal defense.
 */
test("providerSkillsService manages Codex global skills safely", {
	concurrency: false,
}, async () => {
	const tempRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "llm-skills-create-"),
	);
	const restoreHomeDir = patchHomeDir(tempRoot);

	try {
		const created = await providerSkillsService.addProviderSkills("codex", {
			entries: [
				{
					directoryName: "uploaded-codex-folder",
					fileName: "SKILL.md",
					content:
						"---\nname: codex-global\ndescription: Codex global skill\n---\n\nCodex body.\n",
					files: [
						{
							relativePath: "scripts/run.js",
							content: Buffer.from('console.log("codex skill");\n').toString(
								"base64",
							),
							encoding: "base64",
						},
					],
				},
			],
		});
		const createdSkill = created[0];
		assert.ok(createdSkill);
		assert.equal(createdSkill.command, "$codex-global");
		assert.equal(
			createdSkill.sourcePath.endsWith(
				path.join(".agents", "skills", "uploaded-codex-folder", "SKILL.md"),
			),
			true,
		);
		assert.equal(
			await fs.readFile(
				path.join(path.dirname(createdSkill.sourcePath), "scripts", "run.js"),
				"utf8",
			),
			'console.log("codex skill");\n',
		);

		const fallbackSkills = await providerSkillsService.addProviderSkills(
			"codex",
			{
				entries: [
					{
						fileName: "fallback / skill.md",
						content:
							"---\ndescription: Normalized fallback skill\n---\n\nFallback body.\n",
					},
				],
			},
		);
		assert.equal(fallbackSkills[0]?.name, "fallback-skill");
		assert.equal(fallbackSkills[0]?.command, "$fallback-skill");

		const replaced = await providerSkillsService.addProviderSkills("codex", {
			entries: [
				{
					directoryName: "uploaded-codex-folder",
					content:
						"---\nname: replacement\ndescription: Replacement skill\n---\n\nReplacement body.\n",
				},
			],
		});
		assert.equal(replaced[0]?.command, "$replacement");
		assert.match(
			await fs.readFile(createdSkill.sourcePath, "utf8"),
			/Replacement body\./,
		);
		await assert.rejects(
			fs.stat(
				path.join(path.dirname(createdSkill.sourcePath), "scripts", "run.js"),
			),
			{ code: "ENOENT" },
		);

		const pendingBatchPath = path.join(
			tempRoot,
			".agents",
			"skills",
			"pending-batch",
			"SKILL.md",
		);
		await assert.rejects(
			providerSkillsService.addProviderSkills("codex", {
				entries: [
					{
						directoryName: "pending-batch",
						content: "---\nname: pending-batch\n---\n",
					},
					{
						directoryName: "pending-batch",
						content: "---\nname: duplicate-batch\n---\n",
					},
				],
			}),
			/duplicate skill target/i,
		);
		await assert.rejects(fs.stat(pendingBatchPath), { code: "ENOENT" });

		const listed = await providerSkillsService.listProviderSkills("codex");
		assert.equal(
			listed.some((skill) => skill.name === "replacement"),
			true,
		);

		const removed = await providerSkillsService.removeProviderSkill("codex", {
			directoryName: "uploaded-codex-folder",
		});
		assert.equal(removed.removed, true);
		assert.equal(removed.provider, "codex");
		await assert.rejects(fs.stat(path.dirname(createdSkill.sourcePath)), {
			code: "ENOENT",
		});

		const removedMissing = await providerSkillsService.removeProviderSkill(
			"codex",
			{
				directoryName: "uploaded-codex-folder",
			},
		);
		assert.equal(removedMissing.removed, false);

		await assert.rejects(
			providerSkillsService.addProviderSkills("codex", {
				entries: [
					{
						content: "---\nname: unsafe-skill\n---\n",
						files: [
							{ relativePath: "../outside.js", content: "", encoding: "utf8" },
						],
					},
				],
			}),
			/invalid supporting file path/i,
		);
	} finally {
		restoreHomeDir();
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});
