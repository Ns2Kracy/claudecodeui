import type { ChildProcess } from 'node:child_process';
import path from 'node:path';

const HOSTNAME = '127.0.0.1';
const PREFERRED_PORT = 20128;
const PORT_CANDIDATE_COUNT = 32;
const HEALTH_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 10_000;
const STOP_KILL_DEADLINE_MS = 5_000;
const MAX_RAPID_CRASHES = 3;
const MAX_RESTART_DELAY_MS = 30_000;
const STABLE_RESTART_WINDOW_MS = 60_000;
const STDERR_LIMIT = 1024;
const MAX_HEALTH_FIELD_LENGTH = 128;
const ALLOWED_ENV_KEYS = ['HOME', 'PATH', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV'] as const;

export type NineRouterRuntimeState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'unavailable';

type RoutingSafeErrorCode =
  | 'ROUTING_PACKAGE_MISSING'
  | 'ROUTING_PORT_OCCUPIED'
  | 'ROUTING_DATA_DIR_UNAVAILABLE'
  | 'ROUTING_STARTUP_TIMEOUT'
  | 'ROUTING_PROCESS_FAILED';

export type NineRouterRuntimeSafeError = {
  code: RoutingSafeErrorCode;
  message: string;
  retryable: boolean;
};

export type NineRouterRuntimeStatus = {
  state: NineRouterRuntimeState;
  origin: string | null;
  version: string | null;
  lastError: NineRouterRuntimeSafeError | null;
};

type InternalCredentials = {
  jwtSecret: string;
  initialPassword: string;
  apiKeySecret: string;
  dataPlaneKey: string | (() => string);
  machineIdSalt: string;
};

export type NineRouterInternalCredentials = Omit<InternalCredentials, 'dataPlaneKey'> & { dataPlaneKey: string; dataDir: string };

type InternalRuntimeCredentials = NineRouterInternalCredentials;

type PackageResolver = {
  resolveOfficialServerPath(): Promise<string | null>;
};

type ProcessSpawner = {
  spawn(command: string, args: string[], options: { detached: false; env: NodeJS.ProcessEnv; stdio: ['ignore', 'ignore', 'pipe'] }): ChildProcess;
};

type PortAvailability = {
  isAvailable(host: string, port: number): Promise<boolean>;
};

type HealthChecker = {
  check(baseUrl: string): Promise<{ ok: boolean; origin?: string; version?: string }>;
};

type DataPlaneKeyProvisioner = {
  provision(baseUrl: string, credentials: InternalRuntimeCredentials): Promise<void>;
};

type RuntimeFilesystem = {
  ensureDataDir(path: string, mode: 0o700): Promise<void>;
};

type Clock = {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
};

type NineRouterRuntimeDependencies = {
  credentials: InternalCredentials;
  databasePath: string;
  filesystem: RuntimeFilesystem;
  packageResolver: PackageResolver;
  processSpawner: ProcessSpawner;
  portAvailability: PortAvailability;
  health: HealthChecker;
  dataPlaneKeyProvisioner?: DataPlaneKeyProvisioner;
  clock: Clock;
  env?: NodeJS.ProcessEnv;
  onStatusChange?: (status: NineRouterRuntimeStatus) => void;
};

type StopWaiter = { child: ChildProcess; resolve: () => void; timer: unknown };

function initialStatus(): NineRouterRuntimeStatus {
  return { state: 'stopped', origin: null, version: null, lastError: null };
}

function safeMessage(message: string): string {
  return message.length > STDERR_LIMIT ? message.slice(message.length - STDERR_LIMIT) : message;
}

function getDataDir(databasePath: string): string {
  return path.join(path.dirname(databasePath), '9router');
}

function runtimeCredentials(dependencies: NineRouterRuntimeDependencies): InternalRuntimeCredentials {
  const dataPlaneKey = typeof dependencies.credentials.dataPlaneKey === 'function'
    ? dependencies.credentials.dataPlaneKey()
    : dependencies.credentials.dataPlaneKey;
  return { ...dependencies.credentials, dataPlaneKey, dataDir: getDataDir(dependencies.databasePath) };
}

function redact(message: string, secrets: InternalRuntimeCredentials): string {
  let result = message;
  for (const secret of Object.values(secrets)) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return safeMessage(result);
}

function routingError(code: RoutingSafeErrorCode, message: string, retryable: boolean, secrets: InternalRuntimeCredentials): NineRouterRuntimeSafeError {
  return { code, message: redact(message, secrets), retryable };
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeHealthField(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length > MAX_HEALTH_FIELD_LENGTH) return null;
  return /^[\w .:@/-]+$/.test(value) ? value : null;
}

function buildEnv(source: NodeJS.ProcessEnv, credentials: InternalRuntimeCredentials, port: number): NodeJS.ProcessEnv {
  const baseUrl = `http://${HOSTNAME}:${port}`;
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  env.PORT = String(port);
  env.HOSTNAME = HOSTNAME;
  env.DATA_DIR = credentials.dataDir;
  env.JWT_SECRET = credentials.jwtSecret;
  env.INITIAL_PASSWORD = credentials.initialPassword;
  env.API_KEY_SECRET = credentials.apiKeySecret;
  env.MACHINE_ID_SALT = credentials.machineIdSalt;
  env.BASE_URL = baseUrl;
  env.NEXT_PUBLIC_BASE_URL = baseUrl;
  env.NODE_ENV = source.NODE_ENV ?? 'production';
  return env;
}

function clearAll(clock: Clock, timers: Set<unknown>): void {
  for (const timer of timers) clock.clearTimeout(timer);
  timers.clear();
}

/**
 * Consumed by future routing module startup code and tests to supervise the
 * bundled official 9router HTTP runtime without wiring a singleton yet.
 */
export function createNineRouterRuntimeService(dependencies: NineRouterRuntimeDependencies) {
  let status = initialStatus();
  let child: ChildProcess | null = null;
  let stopping = false;
  let readinessGeneration = 0;
  let rapidCrashCount = 0;
  const timers = new Set<unknown>();
  const stopWaiters: StopWaiter[] = [];
  const readinessWaiters = new Set<() => void>();

  function cloneStatus(): NineRouterRuntimeStatus {
    return { ...status, lastError: status.lastError ? { ...status.lastError } : null };
  }

  function transition(nextStatus: NineRouterRuntimeStatus): void {
    status = nextStatus;
    dependencies.onStatusChange?.(cloneStatus());
  }

  function setTimer(callback: () => void, delayMs: number): unknown {
    const timer = dependencies.clock.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
    return timer;
  }

  function sleep(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        readinessWaiters.delete(done);
        resolve();
      };
      readinessWaiters.add(done);
      setTimer(done, delayMs);
    });
  }

  function cancelReadiness(): void {
    for (const resolve of [...readinessWaiters]) resolve();
  }

  function captured(generation: number): boolean {
    return generation === readinessGeneration && !stopping;
  }

  function setUnavailable(error: NineRouterRuntimeSafeError): void {
    transition({ state: 'unavailable', origin: null, version: null, lastError: error });
  }

  function processError(error: unknown): NineRouterRuntimeSafeError {
    return routingError('ROUTING_PROCESS_FAILED', unknownErrorMessage(error), true, runtimeCredentials(dependencies));
  }

  function resolveStopWaiters(completedChild: ChildProcess | null = null): void {
    for (const waiter of [...stopWaiters]) {
      if (completedChild && waiter.child !== completedChild) continue;
      stopWaiters.splice(stopWaiters.indexOf(waiter), 1);
      dependencies.clock.clearTimeout(waiter.timer);
      timers.delete(waiter.timer);
      waiter.resolve();
    }
  }

  function scheduleRestartForTerminal(reason: string): void {
    if (rapidCrashCount + 1 >= MAX_RAPID_CRASHES) {
      rapidCrashCount += 1;
      setUnavailable(routingError('ROUTING_PROCESS_FAILED', reason, true, runtimeCredentials(dependencies)));
      return;
    }
    rapidCrashCount += 1;
    const delay = Math.min(2 ** (rapidCrashCount - 1) * 1_000, MAX_RESTART_DELAY_MS);
    transition({ state: 'degraded', origin: null, version: null, lastError: routingError('ROUTING_PROCESS_FAILED', reason, true, runtimeCredentials(dependencies)) });
    setTimer(() => {
      void start();
    }, delay);
  }

  function handleTerminal(currentChild: ChildProcess, reason: string, terminateOwnedChild: boolean): void {
    resolveStopWaiters(currentChild);
    if (child !== currentChild) return;

    child = null;
    readinessGeneration += 1;
    cancelReadiness();
    if (terminateOwnedChild) currentChild.kill('SIGTERM');
    if (stopping) return;
    scheduleRestartForTerminal(reason);
  }

  function handleExit(currentChild: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    const reason = `9router exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    handleTerminal(currentChild, reason, false);
  }

  function handleChildError(currentChild: ChildProcess, error: unknown): void {
    handleTerminal(currentChild, unknownErrorMessage(error), true);
  }

  async function pollUntilReady(generation: number, currentChild: ChildProcess, baseUrl: string, deadlineMs: number): Promise<void> {
    const started = dependencies.clock.now().getTime();
    while (dependencies.clock.now().getTime() - started <= deadlineMs) {
      if (!captured(generation) || child !== currentChild) return;
      let health: { ok: boolean; origin?: string; version?: string };
      try {
        health = await dependencies.health.check(baseUrl);
      } catch (error) {
        health = { ok: false };
      }
      if (!captured(generation) || child !== currentChild) return;
      if (health.ok) {
        if (dependencies.dataPlaneKeyProvisioner) {
          try {
            await dependencies.dataPlaneKeyProvisioner.provision(baseUrl, runtimeCredentials(dependencies));
          } catch (error) {
            if (!captured(generation) || child !== currentChild) return;
            setUnavailable(routingError('ROUTING_PROCESS_FAILED', `Unable to provision 9router data-plane key: ${unknownErrorMessage(error)}`, true, runtimeCredentials(dependencies)));
            await stopManaged(true);
            return;
          }
        }
        if (!captured(generation) || child !== currentChild) return;
        transition({
          state: 'ready',
          origin: safeHealthField(health.origin),
          version: safeHealthField(health.version),
          lastError: null,
        });
        setTimer(() => {
          if (child === currentChild && status.state === 'ready') rapidCrashCount = 0;
        }, STABLE_RESTART_WINDOW_MS);
        return;
      }
      await sleep(HEALTH_POLL_MS);
    }
    if (!captured(generation) || child !== currentChild) return;
    setUnavailable(routingError('ROUTING_STARTUP_TIMEOUT', '9router readiness timed out', true, runtimeCredentials(dependencies)));
    await stopManaged(true);
  }

  async function start(): Promise<NineRouterRuntimeStatus> {
    if (status.state === 'starting' || status.state === 'ready') return status;
    stopping = false;
    const generation = readinessGeneration + 1;
    readinessGeneration = generation;
    transition({ state: 'starting', origin: null, version: null, lastError: null });

    let serverPath: string | null;
    try {
      serverPath = await dependencies.packageResolver.resolveOfficialServerPath();
    } catch (error) {
      setUnavailable(processError(error));
      return status;
    }
    if (!captured(generation)) return status;
    if (!serverPath) {
      setUnavailable(routingError('ROUTING_PACKAGE_MISSING', '9router package app/custom-server.js was not found', false, runtimeCredentials(dependencies)));
      return status;
    }

    let selectedPort: number | null = null;
    try {
      for (let offset = 0; offset < PORT_CANDIDATE_COUNT; offset += 1) {
        const candidate = PREFERRED_PORT + offset;
        if (await dependencies.portAvailability.isAvailable(HOSTNAME, candidate)) {
          selectedPort = candidate;
          break;
        }
      }
    } catch (error) {
      setUnavailable(processError(error));
      return status;
    }
    if (!captured(generation)) return status;
    if (selectedPort === null) {
      setUnavailable(routingError('ROUTING_PORT_OCCUPIED', `No available 9router port on ${HOSTNAME}:${PREFERRED_PORT}-${PREFERRED_PORT + PORT_CANDIDATE_COUNT - 1}`, true, runtimeCredentials(dependencies)));
      return status;
    }
    const baseUrl = `http://${HOSTNAME}:${selectedPort}`;

    const credentials = runtimeCredentials(dependencies);
    try {
      await dependencies.filesystem.ensureDataDir(credentials.dataDir, 0o700);
    } catch (error) {
      if (captured(generation)) {
        setUnavailable(routingError('ROUTING_DATA_DIR_UNAVAILABLE', `Unable to prepare 9router data directory: ${unknownErrorMessage(error)}`, true, credentials));
      }
      return status;
    }
    if (!captured(generation)) return status;

    let currentChild: ChildProcess;
    try {
      if (!captured(generation)) return status;
      currentChild = dependencies.processSpawner.spawn(process.execPath, [serverPath], {
        detached: false,
        env: buildEnv(dependencies.env ?? process.env, credentials, selectedPort),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      setUnavailable(processError(error));
      return status;
    }

    if (!captured(generation)) {
      currentChild.kill('SIGTERM');
      return status;
    }

    child = currentChild;
    currentChild.stderr?.on('data', (chunk: Buffer) => {
      transition({ ...status, lastError: routingError('ROUTING_PROCESS_FAILED', String(chunk), true, runtimeCredentials(dependencies)) });
    });
    currentChild.on('error', (error: unknown) => handleChildError(currentChild, error));
    currentChild.on('exit', (code: number | null, signal: NodeJS.Signals | null) => handleExit(currentChild, code, signal));
    await pollUntilReady(generation, currentChild, baseUrl, READINESS_TIMEOUT_MS);
    return status;
  }

  async function stopManaged(preserveStatus: boolean): Promise<void> {
    stopping = true;
    readinessGeneration += 1;
    cancelReadiness();
    clearAll(dependencies.clock, timers);
    const current = child;
    if (!current) {
      if (!preserveStatus) transition(initialStatus());
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimer(() => {
        current.kill('SIGKILL');
        resolveStopWaiters(current);
      }, STOP_KILL_DEADLINE_MS);
      stopWaiters.push({ child: current, resolve, timer });
      current.kill('SIGTERM');
    });
    child = null;
    clearAll(dependencies.clock, timers);
    if (!preserveStatus) transition(initialStatus());
  }

  async function stop(): Promise<void> {
    await stopManaged(false);
  }

  return {
    start,
    stop,
    async restart(): Promise<NineRouterRuntimeStatus> {
      await stop();
      return start();
    },
    getStatus(): NineRouterRuntimeStatus {
      return cloneStatus();
    },
    getInternalCredentials(): InternalRuntimeCredentials {
      return runtimeCredentials(dependencies);
    },
  };
}

export type NineRouterRuntimeServiceDependencies = NineRouterRuntimeDependencies;
