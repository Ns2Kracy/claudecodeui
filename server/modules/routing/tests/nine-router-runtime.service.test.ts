import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';

import { createNineRouterRuntimeService, type NineRouterRuntimeServiceDependencies } from '../nine-router-runtime.service.js';

type FakeChild = {
  pid: number;
  stderr: { on(event: string, listener: (chunk: Buffer) => void): unknown };
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
  emitExit(code: number | null, signal: NodeJS.Signals | null): void;
  pushStderr(chunk: string): void;
  killedSignals: NodeJS.Signals[];
};

type TimerEntry = { id: number; delayMs: number; callback: () => void };

function createFakeChild(pid = 9876): FakeChild {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  return {
    pid,
    killedSignals: [],
    stderr: {
      on(event: string, listener: (chunk: Buffer) => void) {
        if (event === 'data') stderrListeners.push(listener);
        return this;
      },
    } as FakeChild['stderr'],
    on(event: string, listener: (...args: unknown[]) => void) {
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
    pushStderr(chunk: string) {
      for (const listener of stderrListeners) listener(Buffer.from(chunk));
    },
  };
}

async function flushAsyncStart(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createHarness(overrides: Partial<NineRouterRuntimeServiceDependencies> = {}) {
  const child = createFakeChild();
  const timers: TimerEntry[] = [];
  let timerId = 0;
  let nowMs = Date.parse('2026-08-05T03:00:00.000Z');
  const clearedTimers: number[] = [];
  const spawnCalls: Array<{ command: string; args: string[]; options: { detached: boolean; env: NodeJS.ProcessEnv; stdio: string[] } }> = [];
  const portChecks: boolean[] = [];
  const healthChecks: Array<{ ok: boolean; origin?: string; version?: string }> = [];
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
        spawnCalls.push({ command, args, options });
        return child as unknown as ChildProcess;
      },
    },
    portAvailability: {
      isAvailable: async () => portChecks.shift() ?? true,
    },
    health: {
      check: async () => healthChecks.shift() ?? { ok: false },
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
    const timer = timers.shift();
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
  return { child, timers, clearedTimers, spawnCalls, portChecks, healthChecks, service, runNextTimer, runTimersUntil };
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
  assert.match(missing.service.getStatus().lastError ?? '', /package/);
  assert.equal(missing.spawnCalls.length, 0);

  const occupied = createHarness();
  occupied.portChecks.push(false);
  await occupied.service.start();
  assert.equal(occupied.service.getStatus().state, 'unavailable');
  assert.match(occupied.service.getStatus().lastError ?? '', /occupied/);
  assert.equal(occupied.spawnCalls.length, 0);
  assert.deepEqual(occupied.child.killedSignals, []);

  const timeout = createHarness();
  const startPromise = timeout.service.start();
  await flushAsyncStart();
  await timeout.runTimersUntil(() => timeout.service.getStatus().state === 'unavailable');
  timeout.child.emitExit(null, 'SIGTERM');
  await startPromise;
  assert.deepEqual(timeout.service.getStatus(), {
    state: 'unavailable',
    origin: null,
    version: null,
    lastError: '9router readiness timed out',
  });
  assert.deepEqual(timeout.child.killedSignals, ['SIGTERM']);
  assert.equal(timeout.spawnCalls.length, 1);
});

test('stop terminates the managed child with SIGTERM and SIGKILL after the deadline, then clears timers', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  await harness.service.start();

  const stopPromise = harness.service.stop();
  assert.deepEqual(harness.child.killedSignals, ['SIGTERM']);
  harness.runNextTimer();
  assert.deepEqual(harness.child.killedSignals, ['SIGTERM', 'SIGKILL']);
  harness.child.emitExit(null, 'SIGTERM');
  await stopPromise;

  assert.equal(harness.service.getStatus().state, 'stopped');
  assert.equal(harness.timers.every((timer) => harness.clearedTimers.includes(timer.id)), true);
});

test('unexpected exits restart with capped exponential backoff and open the circuit breaker', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  await harness.service.start();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    harness.child.emitExit(1, null);
    const status = harness.service.getStatus();
    assert.notEqual(status.lastError?.includes('jwt-secret-value'), true);
    const restartTimer = harness.timers.at(-1);
    if (attempt < 3) {
      assert.equal(status.state, 'degraded');
      assert.ok(restartTimer);
      assert.ok(restartTimer.delayMs <= 30_000);
    } else {
      assert.equal(status.state, 'unavailable');
    }
  }
});

test('getInternalCredentials returns injected secrets while status and redacted stderr never expose them', async () => {
  const harness = createHarness();
  harness.healthChecks.push({ ok: true, origin: '9router', version: '0.5.45' });
  await harness.service.start();
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
