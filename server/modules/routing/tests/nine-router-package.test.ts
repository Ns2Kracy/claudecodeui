import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readProjectFile(path: string): string {
	return readFileSync(join(projectRoot, path), "utf8");
}

function composeServiceBlock(compose: string, serviceName: string): string {
	const match = compose.match(
		new RegExp(
			`\\n  ${serviceName}:\\n[\\s\\S]*?(?=\\n  [^\\s].*:\\n|\\n[^\\s]|$)`,
		),
	);
	assert.notEqual(match, null);
	return match?.[0] ?? "";
}

test("production compose pins the reproducible 1.37.6 release and official Router", () => {
	const compose = readProjectFile("compose.prod.yaml");

	assert.match(compose, /image:\s+ns2kracy\/cloudcli:1\.37\.6/);
	assert.match(compose, /image:\s+decolua\/9router:0\.5\.50/);
	assert.match(compose, /NINE_ROUTER_BASE_URL:\s+http:\/\/9router:20128/);
	assert.match(compose, /HOST:\s+0\.0\.0\.0/);
	assert.match(compose, /SERVER_PORT:\s+["']3001["']/);
	assert.match(compose, /(?:\$\{CLOUDCLI_PORT:-3001\}|3001):3001/);
	assert.match(compose, /(?:\$\{CODEX_CALLBACK_PORT:-1455\}|1445):1455/);
	assert.match(compose, /\/DATA\/AppData\/\$\{AppID\}\/:\/workspaces/);
	assert.match(compose, /\/DATA\/AppData\/\$\{AppID\}\/9router:\/app\/data/);
	assert.equal(JSON.parse(readProjectFile("package.json")).version, "1.37.6");
	assert.equal(JSON.parse(readProjectFile("package-lock.json")).version, "1.37.6");
});

test("compose runs the official Router as an internal persisted sidecar", () => {
	const compose = readProjectFile("compose.yml");
	const nineRouter = composeServiceBlock(`\n${compose}`, "9router");

	assert.match(nineRouter, /image:\s+decolua\/9router:0\.5\.50/);
	assert.doesNotMatch(nineRouter, /build:/);
	assert.match(compose, /NINE_ROUTER_BASE_URL:\s+http:\/\/9router:20128/);
	assert.match(compose, /NINE_ROUTER_ADMIN_PASSWORD:\s+["']9router["']/);
	assert.match(nineRouter, /-\s+9router-data:\/app\/data/);
	assert.match(nineRouter, /expose:\s*\n\s*-\s+"?20128"?/);
	assert.doesNotMatch(nineRouter, /ports:/);
	assert.match(nineRouter, /DATA_DIR:\s+\/app\/data/);
	assert.match(nineRouter, /INITIAL_PASSWORD:\s+["']9router["']/);
	assert.doesNotMatch(nineRouter, /healthcheck:/);
	assert.match(compose, /condition:\s+service_started/);
	assert.match(compose, /cloudcli-private:/);
	assert.doesNotMatch(compose, /internal:\s+true/);
	assert.match(compose, /9router-data:/);
	assert.match(compose, /dockerfile:\s+docker\/cloudcli\/Dockerfile/);
	const cloudcliDockerfile = readProjectFile("docker/cloudcli/Dockerfile");
	assert.match(cloudcliDockerfile, /npm ci --ignore-scripts --include=dev/);
	assert.match(cloudcliDockerfile, /npm rebuild better-sqlite3 bcrypt node-pty/);
	assert.match(cloudcliDockerfile, /RUN npm run build/);
});

test("Docker build context ignores local dependencies, builds, and secrets", () => {
	const dockerignore = readProjectFile(".dockerignore");
	for (const ignored of ["node_modules", "dist", "dist-server", ".env", "database", ".git"]) {
		assert.match(dockerignore, new RegExp(`(^|\\n)${ignored.replace(".", "\\.")}(\\n|$)`));
	}
});

test("environment example documents the sidecar origin without baking credentials", () => {
	const envExample = readProjectFile(".env.example");
	assert.match(envExample, /NINE_ROUTER_BASE_URL=http:\/\/9router:20128/);
	assert.match(envExample, /Compose-owned 9router sidecar/);
});
