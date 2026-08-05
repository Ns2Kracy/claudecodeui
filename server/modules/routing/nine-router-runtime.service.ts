import type { ChildProcess } from 'node:child_process';

const HOSTNAME = '127.0.0.1';
const PORT = 20128;
const BASE_URL = `http://${HOSTNAME}:${PORT}`;
const HEALTH_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 10_000;
const STOP_KILL_DEADLINE_MS = 5_000;
const MAX_RESTARTS = 3;
const MAX_RESTART_DELAY_MS = 30_000;
const STDERR_LIMIT = 1024;
const ALLOWED_ENV_KEYS = ['HOME', 'PATH', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV'] as const;

type RuntimeState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'unavailable';

type RuntimeStatus = {
  state: RuntimeState;
  origin: string | null;
  version: string | null;
  lastError: string | null;
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

function safeError(message: string): string {
  return message.length > STDERR_LIMIT ? message.slice(message.length - STDERR_LIMIT) : message;
}

function redact(message: string, secrets: InternalCredentials): string {
  let result = message;
  for (const secret of Object.values(secrets)) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return safeError(result);
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
  let restartAttempts = 0;
  const timers = new Set<unknown>();
  const stopWaiters: StopWaiter[] = [];

  function setTimer(callback: () => void, delayMs: number): unknown {
    const timer = dependencies.clock.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
    return timer;
  }

  function setUnavailable(error: string): void {
    status = { state: 'unavailable', origin: null, version: null, lastError: redact(error, dependencies.credentials) };
  }

  function handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    child = null;
    for (const waiter of stopWaiters.splice(0)) {
      dependencies.clock.clearTimeout(waiter.timer);
      timers.delete(waiter.timer);
      waiter.resolve();
    }
    if (stopping) return;

    const reason = `9router exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    if (restartAttempts >= MAX_RESTARTS) {
      setUnavailable(reason);
      return;
    }
    restartAttempts += 1;
    const delay = Math.min(2 ** (restartAttempts - 1) * 1_000, MAX_RESTART_DELAY_MS);
    status = { ...status, state: 'degraded', lastError: redact(reason, dependencies.credentials) };
    setTimer(() => {
      void start();
    }, delay);
  }

  async function pollUntilReady(deadlineMs: number): Promise<void> {
    const started = dependencies.clock.now().getTime();
    while (dependencies.clock.now().getTime() - started <= deadlineMs) {
      const health = await dependencies.health.check(BASE_URL);
      if (health.ok) {
        restartAttempts = 0;
        status = {
          state: 'ready',
          origin: health.origin ?? null,
          version: health.version ?? null,
          lastError: null,
        };
        return;
      }
      await new Promise<void>((resolve) => setTimer(resolve, HEALTH_POLL_MS));
    }
    setUnavailable('9router readiness timed out');
    await stopManaged(true);
  }

  async function start(): Promise<RuntimeStatus> {
    if (status.state === 'starting' || status.state === 'ready') return status;
    stopping = false;
    status = { state: 'starting', origin: null, version: null, lastError: null };

    const serverPath = await dependencies.packageResolver.resolveOfficialServerPath();
    if (!serverPath) {
      setUnavailable('9router package app/custom-server.js was not found');
      return status;
    }
    const portFree = await dependencies.portAvailability.isAvailable(HOSTNAME, PORT);
    if (!portFree) {
      setUnavailable(`Port ${HOSTNAME}:${PORT} is already occupied`);
      return status;
    }

    child = dependencies.processSpawner.spawn(process.execPath, [serverPath], {
      detached: false,
      env: buildEnv(dependencies.env ?? process.env, dependencies.credentials),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      status = { ...status, lastError: redact(String(chunk), dependencies.credentials) };
    });
    child.on('exit', handleExit);
    await pollUntilReady(READINESS_TIMEOUT_MS);
    return status;
  }

  async function stopManaged(preserveStatus: boolean): Promise<void> {
    stopping = true;
    clearAll(dependencies.clock, timers);
    const current = child;
    if (!current) {
      if (!preserveStatus) status = initialStatus();
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimer(() => {
        current.kill('SIGKILL');
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
      return { ...status };
    },
    getInternalCredentials(): InternalCredentials {
      return { ...dependencies.credentials };
    },
  };
}

/**
 * Consumed by routing/index.ts so future startup wiring can type injected
 * supervisor instances without deep-importing this implementation file.
 */
export type NineRouterRuntimeService = ReturnType<typeof createNineRouterRuntimeService>;

/**
 * Consumed by tests and future module wiring to provide explicit supervisor
 * adapters and credentials while keeping one-use adapter contracts local here.
 */
export type NineRouterRuntimeServiceDependencies = NineRouterRuntimeDependencies;
