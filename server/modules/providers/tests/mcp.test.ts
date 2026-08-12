import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import TOML from '@iarna/toml';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { AppError } from '@/shared/utils.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

/**
 * Covers Codex MCP persistence for user/project scopes and validates unsupported
 * scope/transport combinations now that Codex is the only active agent.
 */
test('providerMcpService handles codex MCP TOML config and capability validation', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-codex-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await providerMcpService.upsertProviderMcpServer('codex', {
      name: 'codex-user-stdio',
      scope: 'user',
      transport: 'stdio',
      command: 'python',
      args: ['server.py'],
      env: { API_KEY: 'x' },
      envVars: ['API_KEY'],
      cwd: '/tmp',
    });

    await providerMcpService.upsertProviderMcpServer('codex', {
      name: 'codex-project-http',
      scope: 'project',
      transport: 'http',
      url: 'https://codex.example.com/mcp',
      headers: { 'X-Custom-Header': 'value' },
      envHttpHeaders: { 'X-API-Key': 'MY_API_KEY_ENV' },
      bearerTokenEnvVar: 'MY_API_TOKEN',
      workspacePath,
    });

    const userConfig = TOML.parse(
      await fs.readFile(path.join(tempRoot, '.codex', 'config.toml'), 'utf8'),
    ) as Record<string, unknown>;
    const userServers = userConfig.mcp_servers as Record<string, unknown>;
    assert.equal((userServers['codex-user-stdio'] as Record<string, unknown>).command, 'python');

    const projectConfig = TOML.parse(
      await fs.readFile(path.join(workspacePath, '.codex', 'config.toml'), 'utf8'),
    ) as Record<string, unknown>;
    const projectServers = projectConfig.mcp_servers as Record<string, unknown>;
    assert.equal(
      (projectServers['codex-project-http'] as Record<string, unknown>).url,
      'https://codex.example.com/mcp',
    );

    await assert.rejects(
      providerMcpService.upsertProviderMcpServer('codex', {
        name: 'codex-local',
        scope: 'local',
        transport: 'stdio',
        command: 'node',
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'MCP_SCOPE_NOT_SUPPORTED' &&
        error.statusCode === 400,
    );

    await assert.rejects(
      providerMcpService.upsertProviderMcpServer('codex', {
        name: 'codex-sse',
        scope: 'project',
        transport: 'sse',
        url: 'https://example.com/sse',
        workspacePath,
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'MCP_TRANSPORT_NOT_SUPPORTED' &&
        error.statusCode === 400,
    );
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Covers the global MCP helper against the active provider registry: it writes
 * once to Codex and rejects transports that are unsafe for global registration.
 */
test('providerMcpService global adder targets only Codex and rejects unsupported transports', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-global-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    const globalResult = await providerMcpService.addMcpServerToAllProviders({
      name: 'global-http',
      scope: 'project',
      transport: 'http',
      url: 'https://global.example.com/mcp',
      workspacePath,
    });

    assert.deepEqual(globalResult, [{ provider: 'codex', created: true }]);

    const codexProject = TOML.parse(
      await fs.readFile(path.join(workspacePath, '.codex', 'config.toml'), 'utf8'),
    ) as Record<string, unknown>;
    assert.ok((codexProject.mcp_servers as Record<string, unknown>)['global-http']);

    await assert.rejects(
      providerMcpService.addMcpServerToAllProviders({
        name: 'global-sse',
        scope: 'project',
        transport: 'sse',
        url: 'https://example.com/sse',
        workspacePath,
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'INVALID_GLOBAL_MCP_TRANSPORT' &&
        error.statusCode === 400,
    );
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
