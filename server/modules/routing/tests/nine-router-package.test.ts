import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

function composeServiceBlock(compose: string, serviceName: string): string {
  const match = compose.match(new RegExp(`\\n  ${serviceName}:\\n[\\s\\S]*?(?=\\n  [^\\s].*:\\n|\\n[^\\s]|$)`));
  assert.notEqual(match, null);
  return match?.[0] ?? '';
}

test('9router Dockerfile uses the official pinned package without copying upstream source', () => {
  const dockerfile = readProjectFile('docker/9router/Dockerfile');

  assert.match(dockerfile, /npm\s+install\s+-g\s+9router@0\.5\.50\b/);
  assert.match(dockerfile, /CMD\s+\[/);
  assert.match(dockerfile, /"9router"/);
  assert.match(dockerfile, /"--host",\s*"0\.0\.0\.0"/);
  assert.match(dockerfile, /"--port",\s*"20128"/);
  assert.match(dockerfile, /HOME=\/data/);
  assert.match(dockerfile, /VOLUME\s+\["\/data"\]/);
  assert.doesNotMatch(dockerfile, /HEALTHCHECK/);
  assert.doesNotMatch(dockerfile, /^\s*(COPY|ADD)\b/im);
});

test('compose runs 9router as an internal persisted sidecar for CloudCLI', () => {
  const compose = readProjectFile('compose.yml');
  const nineRouter = composeServiceBlock(`\n${compose}`, '9router');

  assert.match(nineRouter, /9router:/);
  assert.match(nineRouter, /context:\s+\.\/docker\/9router/);
  assert.match(compose, /NINE_ROUTER_BASE_URL:\s+http:\/\/9router:20128/);
  assert.match(compose, /NINE_ROUTER_ADMIN_PASSWORD:\s+\$\{NINE_ROUTER_ADMIN_PASSWORD:\?Set NINE_ROUTER_ADMIN_PASSWORD for CloudCLI and 9router\}/);
  assert.match(nineRouter, /-\s+9router-data:\/data/);
  assert.match(nineRouter, /expose:\s*\n\s*-\s+"?20128"?/);
  assert.doesNotMatch(nineRouter, /ports:/);
  assert.match(nineRouter, /DATA_DIR:\s+\/data/);
  assert.match(nineRouter, /INITIAL_PASSWORD:\s+\$\{NINE_ROUTER_ADMIN_PASSWORD:\?Set NINE_ROUTER_ADMIN_PASSWORD for CloudCLI and 9router\}/);
  assert.doesNotMatch(nineRouter, /healthcheck:/);
  assert.match(compose, /condition:\s+service_started/);
  assert.match(compose, /cloudcli-private:/);
  assert.doesNotMatch(compose, /internal:\s+true/);
  assert.match(compose, /9router-data:/);
  assert.match(compose, /dockerfile:\s+docker\/cloudcli\/Dockerfile/);
  const cloudcliDockerfile = readProjectFile('docker/cloudcli/Dockerfile');
  assert.match(cloudcliDockerfile, /npm ci --ignore-scripts --include=dev/);
  assert.match(cloudcliDockerfile, /npm rebuild better-sqlite3 bcrypt node-pty/);
  assert.match(cloudcliDockerfile, /RUN npm run build/);
});

test('Docker build context ignores local dependencies, builds, and secrets', () => {
  const dockerignore = readProjectFile('.dockerignore');

  for (const ignored of ['node_modules', 'dist', 'dist-server', '.env', 'database', '.git']) {
    assert.match(dockerignore, new RegExp(`(^|\\n)${ignored.replace('.', '\\.')}(\\n|$)`));
  }
});

test('environment example documents the sidecar origin without baking credentials', () => {
  const envExample = readProjectFile('.env.example');

  assert.match(envExample, /NINE_ROUTER_BASE_URL=http:\/\/9router:20128/);
  assert.match(envExample, /Compose-owned 9router sidecar/);
});
