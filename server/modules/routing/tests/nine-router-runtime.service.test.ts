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

type TimerEntry = { id: number; delayMs: number; callback: () => void };

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
  const portChecks: boolean[] = [];
  const healthChecks: Array<{ ok: boolean; origin?: string; version?: string } | Error> = [];
  const dependencies: NineRouterRuntimeServiceDependencies = {
    credentials: {
      dataDir: '/state/9router',
      jwtSecret: 'jwt-secret-value',
      initialPassword: 'initial-password-value',
      apiKeySecret: 'api-key-secret-value',
      machineIdSalt: 'machine-salt-value',
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
        timers.push({ id, delayMs, callback });
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
    let timer = timers.shift();
    while (timer && clearedTimers.includes(timer.id)) timer = timers.shift();
    assert.ok(timer, 'expected timer to be scheduled');
    nowMs += timer.delayMs;
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
  return { get child() { return children.at(-1)!; }, children, timers, clearedTimers, spawnCalls, portChecks, healthChecks, service, runNextTimer, runTimersUntil };
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
  assert.equal(harness.spawnCalls[0].options.env.NEXT_PUBLIC_BASE_URL, 'http://127.0.0.1:20128');
  assert.equal(harness.spawnCalls[0].options.env.JWT_SECRET, 'jwt-secret-value');
  assert.equal(harness.spawnCalls[0].options.env.SECRET_SHOULD_NOT_LEAK, undefined);

  harness.runNextTimer();
  await startPromise;

  assert.deepEqual(harness.service.getStatus(), {
    state: 'ready',
    origin: '9router',
    version: '0.5.45',
    lastError: null,
  });
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

test('unexpected exits restart distinct children, count rapid crash cycles, and reset only after stable window', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  const firstStart = harness.service.start();
  await flushAsyncStart();
  harness.runNextTimer();
  await firstStart;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const crashed = harness.child;
    crashed.emitExit(1, null);
    const status = harness.service.getStatus();
    assert.notEqual(JSON.stringify(status).includes('jwt-secret-value'), true);
    if (attempt < 3) {
      assert.equal(status.state, 'degraded');
      harness.healthChecks.push({ ok: true, origin: '9router', version: `0.5.${45 + attempt}` });
      harness.runNextTimer();
      await flushAsyncStart();
      harness.runNextTimer();
      await flushAsyncStart();
      assert.notEqual(harness.child.pid, crashed.pid);
      assert.equal(harness.service.getStatus().state, 'ready');
    } else {
      assert.equal(status.state, 'unavailable');
    }
  }
  assert.equal(harness.spawnCalls.length, 4);
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

  const health = createHarness();
  health.healthChecks.push(new Error('health jwt-secret-value failed'));
  const healthStart = health.service.start();
  await flushAsyncStart();
  health.runNextTimer();
  await healthStart;
  assert.equal(health.service.getStatus().state, 'unavailable');
  assert.deepEqual(health.service.getStatus().lastError, {
    code: 'ROUTING_PROCESS_FAILED',
    message: 'health [redacted] failed',
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
