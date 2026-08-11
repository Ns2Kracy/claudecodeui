import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { AppError, readObjectRecord } from '@/shared/utils.js';

export type ApplyCustomCodexProviderInput = {
  configPath?: string;
  baseUrl: string;
  apiKey: string;
};

export type ApplyCustomCodexProviderResult = {
  provider: 'Custom';
};

const defaultConfigPath = (): string => path.join(os.homedir(), '.codex', 'config.toml');

function configInvalid(): AppError {
  return new AppError('The existing Codex configuration is invalid.', {
    code: 'CODEX_CONFIG_INVALID',
    statusCode: 409,
  });
}

function configWriteFailed(): AppError {
  return new AppError('The Codex configuration could not be updated.', {
    code: 'CODEX_CONFIG_WRITE_FAILED',
    statusCode: 500,
  });
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw configWriteFailed();
  }

  try {
    return readObjectRecord(TOML.parse(content)) ?? {};
  } catch {
    throw configInvalid();
  }
}

/** Persists the embedded router as Codex provider `Custom` without selecting it. */
export async function applyCustomCodexProvider(
  input: ApplyCustomCodexProviderInput,
): Promise<ApplyCustomCodexProviderResult> {
  const configPath = input.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath);
  const providers = readObjectRecord(config.model_providers) ?? {};
  const custom = readObjectRecord(providers.Custom) ?? {};

  providers.Custom = {
    ...custom,
    name: 'Custom',
    base_url: input.baseUrl,
    wire_api: 'responses',
    experimental_bearer_token: input.apiKey,
  };
  config.model_providers = providers;

  const directory = path.dirname(configPath);
  const temporaryPath = path.join(directory, `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, TOML.stringify(config as never), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, configPath);
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw configWriteFailed();
  }

  return { provider: 'Custom' };
}
