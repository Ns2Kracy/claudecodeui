import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { appConfigDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_POLICY_KEY = 'workspace_policy';
const DEFAULT_WRAPPER_PATH = path.resolve('scripts/codex-bwrap-wrapper.sh');
const DEFAULT_CODEX_BINARY_PATH = '/usr/local/libexec/cloudcli/codex-real';

type StoredWorkspacePolicy = {
  strictIsolation: boolean;
  isolationConfigured: boolean;
};

type ResolvedWorkspacePolicy = StoredWorkspacePolicy & {
  workspaceRoot: string;
};

type IsolationStatus = {
  available: boolean;
  reason: string | null;
};

type WorkspacePolicyDependencies = {
  deploymentRoot: string;
  config: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  fileSystem: {
    realpath(candidatePath: string): Promise<string>;
    stat(candidatePath: string): Promise<{ isDirectory(): boolean }>;
  };
  probeIsolation(): Promise<IsolationStatus>;
  wrapperPath: string;
  codexBinaryPath: string;
};

type UpdateWorkspacePolicyInput = {
  strictIsolation: unknown;
};

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseStoredPolicy(value: string | null): StoredWorkspacePolicy | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.strictIsolation !== 'boolean') {
      return null;
    }
    return {
      strictIsolation: parsed.strictIsolation,
      // Older records predate the user-facing protection choice and were all
      // created with the former default of false. Treat them as unconfigured.
      isolationConfigured: parsed.isolationConfigured === true,
    };
  } catch {
    return null;
  }
}

/** Used by the workspace service and its tests to keep the capability probe aligned with the real wrapper. */
export function buildWorkspaceIsolationProbeArguments(): string[] {
  return [
    '--unshare-user',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup',
    '--die-with-parent',
    '--new-session',
    '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/proc', '/proc',
    '/usr/bin/true',
  ];
}

async function defaultIsolationProbe(): Promise<IsolationStatus> {
  if (process.platform !== 'linux') {
    return { available: false, reason: 'Strict workspace isolation requires Linux.' };
  }
  try {
    const wrapperPath = process.env.CODEX_BWRAP_WRAPPER || DEFAULT_WRAPPER_PATH;
    const codexBinaryPath = process.env.CODEX_REAL_BINARY || DEFAULT_CODEX_BINARY_PATH;
    await Promise.all([fs.access(wrapperPath), fs.access(codexBinaryPath)]);
    await execFileAsync('bwrap', buildWorkspaceIsolationProbeArguments(), { timeout: 5000 });
    return { available: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bubblewrap probe failed.';
    return { available: false, reason: message };
  }
}

const defaultDependencies: WorkspacePolicyDependencies = {
  deploymentRoot: process.env.WORKSPACES_ROOT || os.homedir(),
  config: appConfigDb,
  fileSystem: {
    realpath: (candidatePath) => fs.realpath(candidatePath),
    stat: (candidatePath) => fs.stat(candidatePath),
  },
  probeIsolation: defaultIsolationProbe,
  wrapperPath: process.env.CODEX_BWRAP_WRAPPER || DEFAULT_WRAPPER_PATH,
  codexBinaryPath: process.env.CODEX_REAL_BINARY || DEFAULT_CODEX_BINARY_PATH,
};

/** Creates workspace policy workflows used by Settings, Projects, File Tree, and Codex runtime. */
export function createWorkspacePolicyService(
  dependencyOverrides: Partial<WorkspacePolicyDependencies> = {},
) {
  const dependencies: WorkspacePolicyDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
    config: dependencyOverrides.config ?? defaultDependencies.config,
    fileSystem: dependencyOverrides.fileSystem ?? defaultDependencies.fileSystem,
  };

  async function resolveExistingDirectory(candidatePath: string, errorCode: string): Promise<string> {
    let resolvedPath: string;
    try {
      resolvedPath = path.resolve(await dependencies.fileSystem.realpath(candidatePath));
      const stats = await dependencies.fileSystem.stat(resolvedPath);
      if (!stats.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new AppError('Workspace root must be an existing directory', {
        code: errorCode,
        statusCode: 400,
      });
    }
    return resolvedPath;
  }

  async function deploymentRoot(): Promise<string> {
    return resolveExistingDirectory(dependencies.deploymentRoot, 'WORKSPACE_DEPLOYMENT_ROOT_INVALID');
  }

  async function loadConfiguredPolicy(): Promise<ResolvedWorkspacePolicy> {
    const resolvedDeploymentRoot = await deploymentRoot();
    const rawPolicy = dependencies.config.get(WORKSPACE_POLICY_KEY);
    if (rawPolicy === null) {
      return {
        workspaceRoot: resolvedDeploymentRoot,
        strictIsolation: true,
        isolationConfigured: true,
      };
    }
    const stored = parseStoredPolicy(rawPolicy);
    if (!stored) {
      throw new AppError('The saved workspace policy is invalid', {
        code: 'WORKSPACE_POLICY_INVALID',
        statusCode: 503,
      });
    }
    // Legacy records may contain a selected workspaceRoot. The application now
    // always uses the deployment mount, so that historical preference is ignored.
    return {
      workspaceRoot: resolvedDeploymentRoot,
      strictIsolation: stored.isolationConfigured ? stored.strictIsolation : true,
      isolationConfigured: true,
    };
  }

  async function resolveCandidatePath(candidatePath: string): Promise<string> {
    const absolutePath = path.resolve(candidatePath);
    let existingAncestor = absolutePath;
    const missingSegments: string[] = [];
    while (true) {
      try {
        const resolvedAncestor = path.resolve(await dependencies.fileSystem.realpath(existingAncestor));
        return path.join(resolvedAncestor, ...missingSegments.reverse());
      } catch (error) {
        const fileError = error as NodeJS.ErrnoException;
        if (fileError.code !== 'ENOENT') throw error;
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) throw error;
        missingSegments.push(path.basename(existingAncestor));
        existingAncestor = parent;
      }
    }
  }

  async function validateCandidate(candidatePath: string) {
    const policy = await loadConfiguredPolicy();
    if (!candidatePath.trim() || candidatePath.includes('\0')) {
      return { valid: false, error: 'Workspace path is required' };
    }
    let resolvedPath: string;
    try {
      resolvedPath = await resolveCandidatePath(candidatePath);
    } catch {
      return { valid: false, error: 'Workspace path could not be resolved safely' };
    }
    if (!isWithin(policy.workspaceRoot, resolvedPath)) {
      return {
        valid: false,
        error: `Workspace path must be within the deployment root: ${policy.workspaceRoot}`,
      };
    }
    return { valid: true, resolvedPath };
  }

  return {
    /** Used by Settings UI to display protection status and isolation capability. */
    async getPolicy() {
      const [policy, isolation] = await Promise.all([
        loadConfiguredPolicy(),
        dependencies.probeIsolation(),
      ]);
      return {
        strictIsolation: policy.strictIsolation,
        isolationAvailable: isolation.available,
        isolationReason: isolation.reason,
      };
    },

    /** Used by Settings API to validate and persist one installation-wide protection choice. */
    async updatePolicy(input: UpdateWorkspacePolicyInput) {
      if (typeof input.strictIsolation !== 'boolean') {
        throw new AppError('strictIsolation is required', {
          code: 'INVALID_WORKSPACE_POLICY',
          statusCode: 400,
        });
      }
      if (input.strictIsolation) {
        const isolation = await dependencies.probeIsolation();
        if (!isolation.available) {
          throw new AppError(isolation.reason || 'Strict workspace isolation is unavailable', {
            code: 'WORKSPACE_ISOLATION_UNAVAILABLE',
            statusCode: 409,
          });
        }
      }
      dependencies.config.set(WORKSPACE_POLICY_KEY, JSON.stringify({
        strictIsolation: input.strictIsolation,
        isolationConfigured: true,
      }));
      return this.getPolicy();
    },

    /** Used by Projects and File Tree to enforce the current persisted root. */
    validatePath(candidatePath: string) {
      return validateCandidate(candidatePath);
    },

    /** Used by File Tree to resolve its dynamic browsing root. */
    async getWorkspaceRoot(): Promise<string> {
      return (await loadConfiguredPolicy()).workspaceRoot;
    },

    /** Used by Codex runtime to validate cwd and build strict SDK launch options. */
    async resolveCodexLaunch(candidatePath: string) {
      const validation = await validateCandidate(candidatePath);
      if (!validation.valid || !validation.resolvedPath) {
        throw new AppError(validation.error || 'Invalid workspace path', {
          code: 'INVALID_WORKSPACE_PATH',
          statusCode: 403,
        });
      }
      const policy = await loadConfiguredPolicy();
      if (!policy.strictIsolation) {
        return {
          workingDirectory: validation.resolvedPath,
          codexPathOverride: undefined,
          replaceEnvironment: false,
          environment: {},
        };
      }
      const isolation = await dependencies.probeIsolation();
      if (!isolation.available) {
        throw new AppError(isolation.reason || 'Strict workspace isolation is unavailable', {
          code: 'WORKSPACE_ISOLATION_UNAVAILABLE',
          statusCode: 503,
        });
      }
      return {
        workingDirectory: validation.resolvedPath,
        codexPathOverride: dependencies.wrapperPath,
        replaceEnvironment: true,
        environment: {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME || os.homedir(),
          LANG: process.env.LANG || 'C.UTF-8',
          ...(process.env.TERM ? { TERM: process.env.TERM } : {}),
          ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
          ...(process.env.HTTP_PROXY ? { HTTP_PROXY: process.env.HTTP_PROXY } : {}),
          ...(process.env.NO_PROXY ? { NO_PROXY: process.env.NO_PROXY } : {}),
          ...(process.env.SSL_CERT_FILE ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE } : {}),
          ...(process.env.SSL_CERT_DIR ? { SSL_CERT_DIR: process.env.SSL_CERT_DIR } : {}),
          // The policy root authorizes which projects may run. The wrapper must
          // mount only this Chat's validated project, never every sibling project.
          CLOUDCLI_WORKSPACE_ROOT: validation.resolvedPath,
          CLOUDCLI_CODEX_BINARY: dependencies.codexBinaryPath,
        },
      };
    },
  };
}

/** Installation-wide workspace policy consumed through the Workspace module barrel. */
export const workspacePolicyService = createWorkspacePolicyService();
