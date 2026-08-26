import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import {
  buildWorkspaceIsolationProbeArguments,
  createWorkspacePolicyService,
} from '../workspace-policy.service.js';

function createFixture(options: { stored?: string | null; isolationAvailable?: boolean } = {}) {
  let stored = options.stored ?? null;
  const writes: Array<[string, string]> = [];
  const directories = new Set(['/media', '/media/projects', '/media/projects/team-a', '/outside']);
  const service = createWorkspacePolicyService({
    deploymentRoot: '/media',
    config: {
      get: () => stored,
      set: (key, value) => {
        stored = value;
        writes.push([key, value]);
      },
    },
    fileSystem: {
      realpath: async (candidate) => path.resolve(candidate),
      stat: async (candidate) => ({ isDirectory: () => directories.has(path.resolve(candidate)) }),
    },
    probeIsolation: async () => ({
      available: options.isolationAvailable ?? true,
      reason: options.isolationAvailable === false ? 'bubblewrap unavailable' : null,
    }),
    wrapperPath: '/app/scripts/codex-bwrap-wrapper.sh',
    codexBinaryPath: '/usr/local/lib/codex-real',
  });
  return { service, writes };
}

test('Bubblewrap capability probe mounts the executable and its dynamic loader paths', () => {
  const arguments_ = buildWorkspaceIsolationProbeArguments();

  for (const systemPath of ['/usr', '/bin', '/lib', '/lib64']) {
    assert.match(arguments_.join(' '), new RegExp(`--ro-bind ${systemPath} ${systemPath}`));
  }
  assert.equal(arguments_.at(-1), '/usr/bin/true');
});

test('workspace policy always defaults to the deployment root with protection enabled', async () => {
  const { service } = createFixture();
  const policy = await service.getPolicy();

  assert.equal(await service.getWorkspaceRoot(), '/media');
  assert.deepEqual(policy, {
    strictIsolation: true,
    isolationAvailable: true,
    isolationReason: null,
  });
});

test('legacy workspace roots are ignored while legacy default-off protection migrates to enabled', async () => {
  const { service } = createFixture({
    stored: JSON.stringify({ workspaceRoot: '/media/projects', strictIsolation: false }),
  });
  const policy = await service.getPolicy();

  assert.equal(await service.getWorkspaceRoot(), '/media');
  assert.equal(policy.strictIsolation, true);
});

test('workspace policy persists only an explicit protection choice', async () => {
  const { service, writes } = createFixture();
  const policy = await service.updatePolicy({ strictIsolation: true });

  assert.equal(await service.getWorkspaceRoot(), '/media');
  assert.equal(policy.strictIsolation, true);
  assert.deepEqual(JSON.parse(writes[0]![1]), {
    strictIsolation: true,
    isolationConfigured: true,
  });
});

test('workspace policy preserves an explicit choice to turn protection off', async () => {
  const { service, writes } = createFixture();
  const policy = await service.updatePolicy({ strictIsolation: false });

  assert.equal(policy.strictIsolation, false);
  assert.deepEqual(JSON.parse(writes[0]![1]), {
    strictIsolation: false,
    isolationConfigured: true,
  });
});

test('workspace policy rejects a missing protection choice', async () => {
  const { service } = createFixture();
  await assert.rejects(
    service.updatePolicy({ strictIsolation: 'yes' }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_WORKSPACE_POLICY',
  );
});

test('workspace policy rejects enabled protection when Bubblewrap is unavailable', async () => {
  const { service } = createFixture({ isolationAvailable: false });
  await assert.rejects(
    service.updatePolicy({ strictIsolation: true }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKSPACE_ISOLATION_UNAVAILABLE',
  );
});

test('an unconfigured installation runs normally when Bubblewrap is unavailable', async () => {
  const { service, writes } = createFixture({ isolationAvailable: false });

  assert.deepEqual(await service.getPolicy(), {
    strictIsolation: false,
    isolationAvailable: false,
    isolationReason: 'bubblewrap unavailable',
  });
  assert.deepEqual(await service.resolveCodexLaunch('/media/projects/team-a'), {
    workingDirectory: '/media/projects/team-a',
    codexPathOverride: undefined,
    replaceEnvironment: false,
    environment: {},
  });
  assert.deepEqual(writes, []);
});

test('an explicit protection choice remains fail-closed when Bubblewrap becomes unavailable', async () => {
  const { service } = createFixture({
    isolationAvailable: false,
    stored: JSON.stringify({ strictIsolation: true, isolationConfigured: true }),
  });

  assert.equal((await service.getPolicy()).strictIsolation, true);
  await assert.rejects(
    service.resolveCodexLaunch('/media/projects/team-a'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKSPACE_ISOLATION_UNAVAILABLE',
  );
});

test('legacy unavailable workspace roots do not restrict the deployment default', async () => {
  const { service } = createFixture({
    stored: JSON.stringify({
      workspaceRoot: '/media/projects/missing',
      strictIsolation: false,
      isolationConfigured: true,
    }),
  });

  assert.equal((await service.validatePath('/media/projects/team-a')).valid, true);
  assert.equal((await service.validatePath('/media/private')).valid, true);
});

test('a malformed persisted protection choice fails closed', async () => {
  const { service } = createFixture({ stored: '{not-json' });

  await assert.rejects(
    service.resolveCodexLaunch('/media/projects/team-a'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKSPACE_POLICY_INVALID',
  );
});

test('workspace validation rejects a missing child beneath a symlinked outside parent', async () => {
  const service = createWorkspacePolicyService({
    deploymentRoot: '/media',
    config: { get: () => null, set: () => undefined },
    fileSystem: {
      realpath: async (candidate) => {
        const resolved = path.resolve(candidate);
        if (resolved === '/media') return '/media';
        if (resolved === '/media/link') return '/outside';
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
      stat: async (candidate) => ({ isDirectory: () => path.resolve(candidate) === '/media' }),
    },
    probeIsolation: async () => ({ available: true, reason: null }),
    wrapperPath: '/wrapper',
    codexBinaryPath: '/codex',
  });

  assert.equal((await service.validatePath('/media/link/new-project')).valid, false);
});

test('strict Codex launch mounts only the current project beneath the default deployment root', async () => {
  const { service } = createFixture({
    stored: JSON.stringify({ workspaceRoot: '/media/projects', strictIsolation: true }),
  });
  const launch = await service.resolveCodexLaunch('/media/projects/team-a');

  assert.equal(launch.workingDirectory, '/media/projects/team-a');
  assert.equal(launch.codexPathOverride, '/app/scripts/codex-bwrap-wrapper.sh');
  assert.equal(launch.environment.CLOUDCLI_WORKSPACE_ROOT, '/media/projects/team-a');
  assert.equal(launch.environment.CLOUDCLI_CODEX_BINARY, '/usr/local/lib/codex-real');
  assert.equal(launch.replaceEnvironment, true);
});

test('Codex launch rejects a requested cwd outside the deployment root', async () => {
  const { service } = createFixture();

  await assert.rejects(
    service.resolveCodexLaunch('/outside'),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_WORKSPACE_PATH',
  );
});
