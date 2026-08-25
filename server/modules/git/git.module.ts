import * as fs from "node:fs/promises";

import spawn from "cross-spawn";

import { projectsDb } from "@/modules/database/index.js";
import { workspacePolicyService } from "@/modules/workspace/index.js";

import { createGitRouter } from "./git.routes.js";

type GitExternalDependencies = Pick<
	Parameters<typeof createGitRouter>[0],
	"queryCodex"
>;

/** Assembles the Git router with the centralized Codex runtime. */
export function createGitModule(externalDependencies: GitExternalDependencies) {
	return createGitRouter({
		fileSystem: fs,
		spawnProcess: spawn,
		resolveProjectPathById: (projectId) =>
			projectsDb.getProjectPathById(projectId),
		validateWorkspacePath: (projectPath) =>
			workspacePolicyService.validatePath(projectPath),
		...externalDependencies,
	});
}
