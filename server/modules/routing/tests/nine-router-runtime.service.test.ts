import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';

import { createNineRouterRuntimeService, type NineRouterRuntimeServiceDependencies } from '../nine-router-runtime.service.js';

type FakeChild = {
  pid: number;
  stderr: { on(event: string, listener: (chunk: Buffer) => unknown): unknown };
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
  emitExit(code: number | null, signal: NodeJS.Signals | null): void;
  emitError(error: Error): void;
  pushStderr(chunk: string): void;
  killedSignals: NodeJS.Signals[];
};

type TimerEntry = { id: number; dueMs: number; callback: () => void };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeChild(pid = 9876): FakeChild {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const stderrListeners: Array<(chunk: Buffer) => unknown> = [];
  return {
    pid,
    killedSignals: [],
    stderr: {
      on(event: string, listener: (chunk: Buffer) => unknown) {
        if (event === 'data') stderrListeners.push(listener);
        return this;
      },
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    kill(signal?: NodeJS.Signals | number) {
      this.killedSignals.push((signal ?? 'SIGTERM') as NodeJS.Signals);
      return true;
    },
    emitExit(code: number | null, signal: NodeJS.Signals | null) {
      for (const listener of listeners.get('exit') ?? []) listener(code, signal);
    },
    emitError(error: Error) {
      for (const listener of listeners.get('error') ?? []) listener(error);
    },
    pushStderr(chunk: string) {
      for (const listener of stderrListeners) listener(Buffer.from(chunk));
    },
  };
}

async function flushAsyncStart(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createHarness(overrides: Partial<NineRouterRuntimeServiceDependencies> = {}) {
  const children: FakeChild[] = [];
  const timers: TimerEntry[] = [];
  let timerId = 0;
  let nextPid = 9876;
  let nowMs = Date.parse('2026-08-05T03:00:00.000Z');
  const clearedTimers: number[] = [];
  const spawnCalls: Array<{ command: string; args: string[]; options: { detached: boolean; env: NodeJS.ProcessEnv; stdio: string[] } }> = [];
  const ensureDataDirCalls: Array<{ path: string; mode: 0o700 }> = [];
  const portChecks: boolean[] = [];
  const healthChecks: Array<{ ok: boolean; origin?: string; version?: string } | Error> = [];
  const dependencies: NineRouterRuntimeServiceDependencies = {
    credentials: {
      jwtSecret: 'jwt-secret-value',
      initialPassword: 'initial-password-value',
      apiKeySecret: 'api-key-secret-value',
      machineIdSalt: 'machine-salt-value',
    },
    databasePath: '/state/cloudcli.sqlite',
    filesystem: {
      ensureDataDir: async (dataDir, mode) => {
        ensureDataDirCalls.push({ path: dataDir, mode });
      },
    },
    packageResolver: {
      resolveOfficialServerPath: async () => '/repo/node_modules/9router/app/custom-server.js',
    },
    processSpawner: {
      spawn: (command, args, options) => {
        const child = createFakeChild(nextPid++);
        children.push(child);
        spawnCalls.push({ command, args, options });
        return child as unknown as ChildProcess;
      },
    },
    portAvailability: {
      isAvailable: async () => portChecks.shift() ?? true,
    },
    health: {
      check: async () => {
        const next = healthChecks.shift() ?? { ok: false };
        if (next instanceof Error) throw next;
        return next;
      },
    },
    clock: {
      now: () => new Date(nowMs),
      setTimeout: (callback, delayMs) => {
        const id = ++timerId;
        timers.push({ id, dueMs: nowMs + delayMs, callback });
        return id;
      },
      clearTimeout: (id) => {
        clearedTimers.push(id as number);
      },
    },
    env: {
      HOME: '/Users/example',
      PATH: '/bin',
      SHELL: '/bin/zsh',
      SECRET_SHOULD_NOT_LEAK: 'nope',
      NODE_ENV: 'test',
    },
    ...overrides,
  };
  const service = createNineRouterRuntimeService(dependencies);
  const runNextTimer = () => {
    timers.sort((a, b) => a.dueMs - b.dueMs || a.id - b.id);
    let timer = timers.shift();
    while (timer && clearedTimers.includes(timer.id)) timer = timers.shift();
    assert.ok(timer, 'expected timer to be scheduled');
    nowMs = timer.dueMs;
    timer.callback();
  };
  const runTimersUntil = async (predicate: () => boolean, maxTimers = 200) => {
    for (let i = 0; i < maxTimers; i += 1) {
      if (predicate()) return;
      runNextTimer();
      await flushAsyncStart();
    }
    assert.fail(`predicate was not reached after ${maxTimers} timers`);
  };
  return { get child() { return children.at(-1)!; }, children, timers, clearedTimers, spawnCalls, ensureDataDirCalls, portChecks, healthChecks, service, runNextTimer, runTimersUntil };
}

test('start resolves the official custom server, spawns node non-interactively, and becomes ready only after health passes', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: false }, { ok: true, origin: '9router', version: '0.5.45' });

  const startPromise = harness.service.start();
  await flushAsyncStart();
  assert.equal(harness.service.getStatus().state, 'starting');
  assert.equal(harness.spawnCalls.length, 1);
  assert.equal(harness.spawnCalls[0].command, process.execPath);
  assert.deepEqual(harness.spawnCalls[0].args, ['/repo/node_modules/9router/app/custom-server.js']);
  assert.equal(harness.spawnCalls[0].options.detached, false);
  assert.deepEqual(harness.spawnCalls[0].options.stdio, ['ignore', 'ignore', 'pipe']);
  assert.equal(harness.spawnCalls[0].options.env.HOSTNAME, '127.0.0.1');
  assert.equal(harness.spawnCalls[0].options.env.PORT, '20128');
  assert.equal(harness.spawnCalls[0].options.env.BASE_URL, 'http://127.0.0.1:20128');
  assert.equal(harness.spawnCalls[0].options.env.DATA_DIR, '/state/9router');
  assert.equal(harness.spawnCalls[0].options.env.NEXT_PUBLIC_BASE_URL, 'http://127.0.0.1:20128');
  assert.equal(harness.spawnCalls[0].options.env.JWT_SECRET, 'jwt-secret-value');
  assert.equal(harness.spawnCalls[0].options.env.SECRET_SHOULD_NOT_LEAK, undefined);
  assert.deepEqual(harness.ensureDataDirCalls, [{ path: '/state/9router', mode: 0o700 }]);

  harness.runNextTimer();
  await startPromise;

  assert.deepEqual(harness.service.getStatus(), {
    state: 'ready',
    origin: '9router',
    version: '0.5.45',
    lastError: null,
  });
});

test('health transport errors during readiness are transient and polling continues until ready', async () => {
  const statusEvents: string[] = [];
  const harness = createHarness({ onStatusChange: (status) => statusEvents.push(status.state) });
  harness.healthChecks.push(new Error('connect ECONNREFUSED 127.0.0.1:20128'), { ok: true, origin: '9router', version: '0.5.45' });

  const startPromise = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await startPromise;

  assert.equal(harness.spawnCalls.length, 1);
  assert.deepEqual(harness.child.killedSignals, []);
  assert.deepEqual(harness.service.getStatus(), {
    state: 'ready',
    origin: '9router',
    version: '0.5.45',
    lastError: null,
  });
  assert.deepEqual(statusEvents, ['starting', 'ready']);
});


test('derives and ensures the 9router data directory from the database path before spawn', async () => {
  const harness = createHarness({ databasePath: '/var/lib/cloudcli/main.db' });
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });

  const startPromise = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await startPromise;

  assert.deepEqual(harness.ensureDataDirCalls, [{ path: '/var/lib/cloudcli/9router', mode: 0o700 }]);
  assert.equal(harness.spawnCalls[0].options.env.DATA_DIR, '/var/lib/cloudcli/9router');
  assert.equal(harness.service.getInternalCredentials().dataDir, '/var/lib/cloudcli/9router');
});

test('data directory preparation failures are reported safely and prevent spawn', async () => {
  const harness = createHarness({
    filesystem: { ensureDataDir: async () => { throw new Error('/state/9router permission denied jwt-secret-value'); } },
  });

  await harness.service.start();

  assert.equal(harness.spawnCalls.length, 0);
  assert.deepEqual(harness.service.getStatus().lastError, {
    code: 'ROUTING_DATA_DIR_UNAVAILABLE',
    message: 'Unable to prepare 9router data directory: [redacted] permission denied [redacted]',
    retryable: true,
  });
});

test('stop can win before spawn after an awaited adapter and resolves stopped without spawning a child', async () => {
  const resolver = deferred<string | null>();
  const harness = createHarness({ packageResolver: { resolveOfficialServerPath: () => resolver.promise } });
  const startPromise = harness.service.start();
  await flushAsyncStart();

  const stopPromise = harness.service.stop();
  resolver.resolve('/repo/node_modules/9router/app/custom-server.js');
  await Promise.all([startPromise, stopPromise]);

  assert.equal(harness.service.getStatus().state, 'stopped');
  assert.equal(harness.spawnCalls.length, 0);
  assert.equal(harness.children.length, 0);
});


test('stop racing immediately after spawn terminates only that owned child without attaching it active', async () => {
  let service: ReturnType<typeof createNineRouterRuntimeService>;
  const harness = createHarness({
    processSpawner: {
      spawn: (command, args, options) => {
        const child = createFakeChild(2222);
        harness.children.push(child);
        harness.spawnCalls.push({ command, args, options });
        void service.stop();
        return child as unknown as ChildProcess;
      },
    },
  });
  service = harness.service;

  await harness.service.start();

  assert.equal(harness.service.getStatus().state, 'stopped');
  assert.equal(harness.spawnCalls.length, 1);
  assert.deepEqual(harness.children[0].killedSignals, ['SIGTERM']);
});

test('package missing, occupied port, and readiness timeout produce safe typed states without spawning or killing a port owner', async () => {
  const missing = createHarness({ packageResolver: { resolveOfficialServerPath: async () => null } });
  await missing.service.start();
  assert.equal(missing.service.getStatus().state, 'unavailable');
  assert.deepEqual(missing.service.getStatus().lastError, {
    code: 'ROUTING_PACKAGE_MISSING',
    message: '9router package app/custom-server.js was not found',
    retryable: false,
  });
  assert.equal(missing.spawnCalls.length, 0);

  const occupied = createHarness();
  occupied.portChecks.push(false);
  await occupied.service.start();
  assert.equal(occupied.service.getStatus().state, 'unavailable');
  assert.deepEqual(occupied.service.getStatus().lastError, {
    code: 'ROUTING_PORT_OCCUPIED',
    message: 'Port 127.0.0.1:20128 is already occupied',
    retryable: true,
  });
  assert.equal(occupied.spawnCalls.length, 0);

  const timeout = createHarness();
  const startPromise = timeout.service.start();
  await flushAsyncStart();
  await timeout.runTimersUntil(() => timeout.service.getStatus().state === 'unavailable');
  timeout.runNextTimer();
  await startPromise;
  assert.deepEqual(timeout.service.getStatus(), {
    state: 'unavailable',
    origin: null,
    version: null,
    lastError: { code: 'ROUTING_STARTUP_TIMEOUT', message: '9router readiness timed out', retryable: true },
  });
  assert.deepEqual(timeout.child.killedSignals, ['SIGTERM', 'SIGKILL']);
  assert.equal(timeout.spawnCalls.length, 1);
});

test('stop during startup cancels readiness polling and resolves the in-flight start promise', async () => {
  const harness = createHarness();
  const startPromise = harness.service.start();
  await flushAsyncStart();
  assert.equal(harness.service.getStatus().state, 'starting');

  const stopPromise = harness.service.stop();
  await harness.runTimersUntil(() => harness.child.killedSignals.includes('SIGKILL'));
  await Promise.all([startPromise, stopPromise]);

  assert.equal(harness.service.getStatus().state, 'stopped');
  assert.deepEqual(harness.child.killedSignals, ['SIGTERM', 'SIGKILL']);
});

test('stop resolves at SIGKILL deadline even when child never emits exit', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const startPromise = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await startPromise;

  const stopPromise = harness.service.stop();
  assert.deepEqual(harness.child.killedSignals, ['SIGTERM']);
  harness.runNextTimer();
  await stopPromise;

  assert.deepEqual(harness.child.killedSignals, ['SIGTERM', 'SIGKILL']);
  assert.equal(harness.service.getStatus().state, 'stopped');
});

test('unexpected exit cancels stale readiness polling and stale health cannot mark the dead child ready', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: false }, { ok: true, origin: 'evil-origin-with-a-very-long-string', version: 'bad-version' });
  const startPromise = harness.service.start();
  await flushAsyncStart();
  harness.child.emitExit(1, null);
  harness.runNextTimer();
  await startPromise;

  assert.equal(harness.service.getStatus().state, 'degraded');
  assert.equal(harness.service.getStatus().origin, null);
  assert.equal(harness.spawnCalls.length, 1);
});

test('stale exit from an old stopped child after replacement does not corrupt the live ready child', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const firstStart = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await firstStart;
  const oldChild = harness.child;

  const stopPromise = harness.service.stop();
  assert.deepEqual(oldChild.killedSignals, ['SIGTERM']);
  harness.runNextTimer();
  await stopPromise;

  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.46' });
  const replacementStart = harness.service.start();
  await flushAsyncStart();
  await replacementStart;
  const replacement = harness.child;
  assert.notEqual(replacement.pid, oldChild.pid);
  assert.equal(harness.service.getStatus().state, 'ready');

  oldChild.emitExit(0, null);

  assert.equal(harness.child.pid, replacement.pid);
  assert.deepEqual(harness.service.getStatus(), {
    state: 'ready',
    origin: '9router',
    version: '0.5.46',
    lastError: null,
  });
});

test('active child error without exit is terminal, restarts once, ignores following exit, and recovers', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const firstStart = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await firstStart;
  const failedChild = harness.child;

  failedChild.emitError(new Error('spawn jwt-secret-value failed'));
  assert.equal(harness.service.getStatus().state, 'degraded');
  assert.deepEqual(failedChild.killedSignals, ['SIGTERM']);
  failedChild.emitExit(1, null);
  assert.equal(harness.spawnCalls.length, 1);

  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.46' });
  harness.runNextTimer();
  await flushAsyncStart();

  assert.equal(harness.spawnCalls.length, 2);
  assert.notEqual(harness.child.pid, failedChild.pid);
  assert.deepEqual(harness.service.getStatus(), {
    state: 'ready',
    origin: '9router',
    version: '0.5.46',
    lastError: null,
  });
});

test('unexpected exits restart distinct children, count rapid crash cycles, and reset only after stable window', async () => {
  const rapid = createHarness();
  rapid.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const firstStart = rapid.service.start();
  await flushAsyncStart();
  rapid.runNextTimer();
  await firstStart;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const crashed = rapid.child;
    crashed.emitExit(1, null);
    const status = rapid.service.getStatus();
    assert.notEqual(JSON.stringify(status).includes('jwt-secret-value'), true);
    assert.equal(status.state, 'degraded');
    rapid.healthChecks.push({ ok: true, origin: '9router', version: `0.5.${46 + attempt}` });
    rapid.runNextTimer();
    await flushAsyncStart();
    assert.notEqual(rapid.child.pid, crashed.pid);
    assert.equal(rapid.service.getStatus().state, 'ready');
  }

  rapid.child.emitExit(1, null);
  assert.equal(rapid.service.getStatus().state, 'unavailable');
  assert.equal(rapid.spawnCalls.length, 3);

  const stable = createHarness();
  stable.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const stableStart = stable.service.start();
  await flushAsyncStart();
  await stableStart;
  stable.runNextTimer();
  stable.child.emitExit(1, null);
  assert.equal(stable.service.getStatus().state, 'degraded');
});

test('adapter throws and child error events become safe unavailable/degraded process failures', async () => {
  const resolver = createHarness({ packageResolver: { resolveOfficialServerPath: async () => { throw new Error('resolver jwt-secret-value failed'); } } });
  await resolver.service.start();
  assert.equal(resolver.service.getStatus().state, 'unavailable');
  assert.deepEqual(resolver.service.getStatus().lastError, {
    code: 'ROUTING_PROCESS_FAILED',
    message: 'resolver [redacted] failed',
    retryable: true,
  });

  const childError = createHarness();
  childError.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const childStart = childError.service.start();
  await flushAsyncStart();
  childError.runNextTimer();
  await childStart;
  childError.child.emitError(new Error('spawn jwt-secret-value failed'));
  assert.equal(childError.service.getStatus().state, 'degraded');
  assert.deepEqual(childError.service.getStatus().lastError, {
    code: 'ROUTING_PROCESS_FAILED',
    message: 'spawn [redacted] failed',
    retryable: true,
  });
});

test('status change callback follows ready, degraded, recovery, unavailable, and stopped states', async () => {
  const statusEvents: string[] = [];
  const harness = createHarness({ onStatusChange: (status) => statusEvents.push(status.state) });
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });

  const firstStart = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await firstStart;

  const firstChild = harness.child;
  firstChild.emitExit(1, null);
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.46' });
  harness.runNextTimer();
  await flushAsyncStart();

  harness.child.emitExit(1, null);
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.47' });
  harness.runNextTimer();
  await flushAsyncStart();
  harness.child.emitExit(1, null);
  await harness.service.stop();

  assert.deepEqual(statusEvents, [
    'starting',
    'ready',
    'degraded',
    'starting',
    'ready',
    'degraded',
    'starting',
    'ready',
    'unavailable',
    'stopped',
  ]);
});

test('getInternalCredentials returns injected secrets while status and redacted stderr never expose them', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const startPromise = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await startPromise;
  harness.child.pushStderr(`failed jwt-secret-value initial-password-value api-key-secret-value ${'x'.repeat(5000)}`);

  assert.deepEqual(harness.service.getInternalCredentials(), {
    dataDir: '/state/9router',
    jwtSecret: 'jwt-secret-value',
    initialPassword: 'initial-password-value',
    apiKeySecret: 'api-key-secret-value',
    machineIdSalt: 'machine-salt-value',
  });
  const serializedStatus = JSON.stringify(harness.service.getStatus());
  assert.equal(serializedStatus.includes('jwt-secret-value'), false);
  assert.equal(serializedStatus.includes('initial-password-value'), false);
  assert.equal(serializedStatus.includes('api-key-secret-value'), false);
  assert.ok(serializedStatus.length < 1500);
});
