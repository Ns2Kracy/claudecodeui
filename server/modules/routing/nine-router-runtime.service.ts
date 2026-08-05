import type { ChildProcess } from 'node:child_process';

const HOSTNAME = '127.0.0.1';
const PORT = 20128;
const BASE_URL = `http://${HOSTNAME}:${PORT}`;
const HEALTH_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 10_000;
const STOP_KILL_DEADLINE_MS = 5_000;
const MAX_RAPID_CRASHES = 3;
const MAX_RESTART_DELAY_MS = 30_000;
const STABLE_RESTART_WINDOW_MS = 60_000;
const STDERR_LIMIT = 1024;
const MAX_HEALTH_FIELD_LENGTH = 128;
const ALLOWED_ENV_KEYS = ['HOME', 'PATH', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV'] as const;

type RuntimeState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'unavailable';

type RoutingSafeErrorCode =
  | 'ROUTING_PACKAGE_MISSING'
  | 'ROUTING_PORT_OCCUPIED'
  | 'ROUTING_STARTUP_TIMEOUT'
  | 'ROUTING_PROCESS_FAILED';

type RoutingSafeError = {
  code: RoutingSafeErrorCode;
  message: string;
  retryable: boolean;
};

type RuntimeStatus = {
  state: RuntimeState;
  origin: string | null;
  version: string | null;
  lastError: RoutingSafeError | null;
};

type InternalCredentials = {
  dataDir: string;
  jwtSecret: string;
  initialPassword: string;
  apiKeySecret: string;
  machineIdSalt: string;
};

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

type Clock = {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
};

type NineRouterRuntimeDependencies = {
  credentials: InternalCredentials;
  packageResolver: PackageResolver;
  processSpawner: ProcessSpawner;
  portAvailability: PortAvailability;
  health: HealthChecker;
  clock: Clock;
  env?: NodeJS.ProcessEnv;
};

type StopWaiter = { resolve: () => void; timer: unknown };

function initialStatus(): RuntimeStatus {
  return { state: 'stopped', origin: null, version: null, lastError: null };
}

function safeMessage(message: string): string {
  return message.length > STDERR_LIMIT ? message.slice(message.length - STDERR_LIMIT) : message;
}

function redact(message: string, secrets: InternalCredentials): string {
  let result = message;
  for (const secret of Object.values(secrets)) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return safeMessage(result);
}

function routingError(code: RoutingSafeErrorCode, message: string, retryable: boolean, secrets: InternalCredentials): RoutingSafeError {
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

function buildEnv(source: NodeJS.ProcessEnv, credentials: InternalCredentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  env.PORT = String(PORT);
  env.HOSTNAME = HOSTNAME;
  env.DATA_DIR = credentials.dataDir;
  env.JWT_SECRET = credentials.jwtSecret;
  env.INITIAL_PASSWORD = credentials.initialPassword;
  env.API_KEY_SECRET = credentials.apiKeySecret;
  env.MACHINE_ID_SALT = credentials.machineIdSalt;
  env.BASE_URL = BASE_URL;
  env.NEXT_PUBLIC_BASE_URL = BASE_URL;
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

  function setUnavailable(error: RoutingSafeError): void {
    status = { state: 'unavailable', origin: null, version: null, lastError: error };
  }

  function processError(error: unknown): RoutingSafeError {
    return routingError('ROUTING_PROCESS_FAILED', unknownErrorMessage(error), true, dependencies.credentials);
  }

  function resolveStopWaiters(): void {
    for (const waiter of stopWaiters.splice(0)) {
      dependencies.clock.clearTimeout(waiter.timer);
      timers.delete(waiter.timer);
      waiter.resolve();
    }
  }

  function handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    child = null;
    readinessGeneration += 1;
    cancelReadiness();
    resolveStopWaiters();
    if (stopping) return;

    const reason = `9router exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    if (rapidCrashCount + 1 >= MAX_RAPID_CRASHES) {
      rapidCrashCount += 1;
      setUnavailable(routingError('ROUTING_PROCESS_FAILED', reason, true, dependencies.credentials));
      return;
    }
    rapidCrashCount += 1;
    const delay = Math.min(2 ** (rapidCrashCount - 1) * 1_000, MAX_RESTART_DELAY_MS);
    status = { state: 'degraded', origin: null, version: null, lastError: routingError('ROUTING_PROCESS_FAILED', reason, true, dependencies.credentials) };
    setTimer(() => {
      void start();
    }, delay);
  }

  function handleChildError(error: unknown): void {
    readinessGeneration += 1;
    status = { state: child ? 'degraded' : 'unavailable', origin: null, version: null, lastError: processError(error) };
  }

  async function pollUntilReady(generation: number, currentChild: ChildProcess, deadlineMs: number): Promise<void> {
    const started = dependencies.clock.now().getTime();
    while (dependencies.clock.now().getTime() - started <= deadlineMs) {
      if (generation !== readinessGeneration || child !== currentChild || stopping) return;
      let health: { ok: boolean; origin?: string; version?: string };
      try {
        health = await dependencies.health.check(BASE_URL);
      } catch (error) {
        if (generation === readinessGeneration && child === currentChild && !stopping) setUnavailable(processError(error));
        await stopManaged(true);
        return;
      }
      if (generation !== readinessGeneration || child !== currentChild || stopping) return;
      if (health.ok) {
        status = {
          state: 'ready',
          origin: safeHealthField(health.origin),
          version: safeHealthField(health.version),
          lastError: null,
        };
        setTimer(() => {
          if (child === currentChild && status.state === 'ready') rapidCrashCount = 0;
        }, STABLE_RESTART_WINDOW_MS);
        return;
      }
      await sleep(HEALTH_POLL_MS);
    }
    if (generation !== readinessGeneration || child !== currentChild || stopping) return;
    setUnavailable(routingError('ROUTING_STARTUP_TIMEOUT', '9router readiness timed out', true, dependencies.credentials));
    await stopManaged(true);
  }

  async function start(): Promise<RuntimeStatus> {
    if (status.state === 'starting' || status.state === 'ready') return status;
    stopping = false;
    const generation = readinessGeneration + 1;
    readinessGeneration = generation;
    status = { state: 'starting', origin: null, version: null, lastError: null };

    let serverPath: string | null;
    try {
      serverPath = await dependencies.packageResolver.resolveOfficialServerPath();
    } catch (error) {
      setUnavailable(processError(error));
      return status;
    }
    if (!serverPath) {
      setUnavailable(routingError('ROUTING_PACKAGE_MISSING', '9router package app/custom-server.js was not found', false, dependencies.credentials));
      return status;
    }

    let portFree: boolean;
    try {
      portFree = await dependencies.portAvailability.isAvailable(HOSTNAME, PORT);
    } catch (error) {
      setUnavailable(processError(error));
      return status;
    }
    if (!portFree) {
      setUnavailable(routingError('ROUTING_PORT_OCCUPIED', `Port ${HOSTNAME}:${PORT} is already occupied`, true, dependencies.credentials));
      return status;
    }

    let currentChild: ChildProcess;
    try {
      currentChild = dependencies.processSpawner.spawn(process.execPath, [serverPath], {
        detached: false,
        env: buildEnv(dependencies.env ?? process.env, dependencies.credentials),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      setUnavailable(processError(error));
      return status;
    }

    child = currentChild;
    currentChild.stderr?.on('data', (chunk: Buffer) => {
      status = { ...status, lastError: routingError('ROUTING_PROCESS_FAILED', String(chunk), true, dependencies.credentials) };
    });
    currentChild.on('error', handleChildError);
    currentChild.on('exit', handleExit);
    await pollUntilReady(generation, currentChild, READINESS_TIMEOUT_MS);
    return status;
  }

  async function stopManaged(preserveStatus: boolean): Promise<void> {
    stopping = true;
    readinessGeneration += 1;
    cancelReadiness();
    clearAll(dependencies.clock, timers);
    const current = child;
    if (!current) {
      if (!preserveStatus) status = initialStatus();
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimer(() => {
        current.kill('SIGKILL');
        resolveStopWaiters();
      }, STOP_KILL_DEADLINE_MS);
      stopWaiters.push({ resolve, timer });
      current.kill('SIGTERM');
    });
    child = null;
    clearAll(dependencies.clock, timers);
    if (!preserveStatus) status = initialStatus();
  }

  async function stop(): Promise<void> {
    await stopManaged(false);
  }

  return {
    start,
    stop,
    async restart(): Promise<RuntimeStatus> {
      await stop();
      return start();
    },
    getStatus(): RuntimeStatus {
      return { ...status, lastError: status.lastError ? { ...status.lastError } : null };
    },
    getInternalCredentials(): InternalCredentials {
      return { ...dependencies.credentials };
    },
  };
}

export type NineRouterRuntimeServiceDependencies = NineRouterRuntimeDependencies;
