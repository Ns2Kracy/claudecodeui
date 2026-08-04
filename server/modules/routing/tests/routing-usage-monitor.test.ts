import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoutingStoredAlert } from '@/shared/types.js';

import type { RoutingUsagePeriod, RoutingUsageView } from '../../../../shared/routing.js';
import { createRoutingUsageMonitor } from '../routing-usage-monitor.js';

function usage(period: RoutingUsagePeriod, estimatedCostMicrousd: number): RoutingUsageView {
  return {
    period,
    requests: 12,
    promptTokens: 120,
    completionTokens: 45,
    estimatedCostMicrousd,
    byProvider: [{ id: 'openai', requests: 12, costMicrousd: estimatedCostMicrousd }],
    staleAt: null,
  };
}

function alert(
  period: RoutingStoredAlert['period'],
  thresholdMicrousd: number,
  enabled = true,
): RoutingStoredAlert {
  return {
    period,
    thresholdMicrousd,
    enabled,
    lastNotifiedPeriodKey: null,
  };
}

function createAlertRepository(alertsByUser: Map<number, RoutingStoredAlert[]>) {
  return {
    listConnectionUserIds: () => [...alertsByUser.keys()],
    listAlerts: (userId: number) => alertsByUser.get(userId)?.map((item) => ({ ...item })) ?? [],
    markAlertNotified: (
      userId: number,
      period: RoutingStoredAlert['period'],
      periodKey: string,
    ) => {
      const stored = alertsByUser.get(userId)?.find((item) => item.period === period);
      if (stored) stored.lastNotifiedPeriodKey = periodKey;
    },
  };
}

test('disabled alerts make no usage calls', async () => {
  const repository = createAlertRepository(new Map([[1, [alert('daily', 100, false)]]]));
  let usageCalls = 0;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async () => {
      usageCalls += 1;
      return usage('today', 500);
    },
    notify: async () => true,
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();
  assert.equal(usageCalls, 0);
});

test('daily and 30-day alerts compare integer micro-USD and notify once per period key', async () => {
  const alertsByUser = new Map([[1, [alert('daily', 500), alert('30d', 2_000)]]]);
  const repository = createAlertRepository(alertsByUser);
  const events: Array<{ userId: number; event: Record<string, unknown> }> = [];
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async (_userId, period) => (
      period === 'today' ? usage('today', 500) : usage('30d', 2_001)
    ),
    notify: async (userId, event) => {
      events.push({ userId, event: event as unknown as Record<string, unknown> });
      return true;
    },
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();
  await monitor.runOnce();

  assert.equal(events.length, 2);
  assert.deepEqual(events.map(({ userId, event }) => ({
    userId,
    period: event.period,
    periodKey: event.periodKey,
    cost: event.estimatedCostMicrousd,
    threshold: event.thresholdMicrousd,
  })), [
    { userId: 1, period: 'daily', periodKey: 'daily:2026-08-04', cost: 500, threshold: 500 },
    { userId: 1, period: '30d', periodKey: '30d:2026-08-04', cost: 2_001, threshold: 2_000 },
  ]);
});

test('suppressed notifications are not marked and remain eligible for a later check', async () => {
  const repository = createAlertRepository(new Map([[1, [alert('daily', 100)]]]));
  let notificationAttempts = 0;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async () => usage('today', 500),
    notify: async () => {
      notificationAttempts += 1;
      return false;
    },
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();
  await monitor.runOnce();

  assert.equal(notificationAttempts, 2);
  assert.equal(repository.listAlerts(1)[0].lastNotifiedPeriodKey, null);
});

test('one failed user connection does not stop checks for another user', async () => {
  const repository = createAlertRepository(new Map([
    [1, [alert('daily', 100)]],
    [2, [alert('daily', 100)]],
  ]));
  const notifiedUsers: number[] = [];
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async (userId) => {
      if (userId === 1) throw new Error('expected connection failure');
      return usage('today', 500);
    },
    notify: async (userId) => {
      notifiedUsers.push(userId);
      return true;
    },
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();
  assert.deepEqual(notifiedUsers, [2]);
});

test('stale usage snapshots never trigger advisory notifications', async () => {
  const repository = createAlertRepository(new Map([[1, [alert('daily', 100)]]]));
  let notifications = 0;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async () => ({
      ...usage('today', 500),
      staleAt: '2026-08-04T07:00:00.000Z',
    }),
    notify: async () => {
      notifications += 1;
      return true;
    },
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();
  assert.equal(notifications, 0);
  assert.equal(repository.listAlerts(1)[0].lastNotifiedPeriodKey, null);
});

test('usage polling concurrency is bounded to three tasks', async () => {
  const alertsByUser = new Map<number, RoutingStoredAlert[]>();
  for (let userId = 1; userId <= 9; userId += 1) {
    alertsByUser.set(userId, [alert('daily', 10_000)]);
  }
  const repository = createAlertRepository(alertsByUser);
  let active = 0;
  let maximumActive = 0;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return usage('today', 0);
    },
    notify: async () => true,
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();
  assert.equal(maximumActive, 3);
});

test('threshold notification events contain safe totals but no raw request metadata', async () => {
  const repository = createAlertRepository(new Map([[1, [alert('daily', 1)]]]));
  const events: unknown[] = [];
  const unsafeUsage = {
    ...usage('today', 250),
    rawPrompt: 'planted-prompt-secret',
    rawResponse: 'planted-response-secret',
    apiKey: 'planted-api-key',
  } as RoutingUsageView;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async () => unsafeUsage,
    notify: async (_userId, event) => {
      events.push(event);
      return true;
    },
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  await monitor.runOnce();

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    code: 'routing.usage.threshold',
    period: 'daily',
    usagePeriod: 'today',
    periodKey: 'daily:2026-08-04',
    requests: 12,
    promptTokens: 120,
    completionTokens: 45,
    estimatedCostMicrousd: 250,
    thresholdMicrousd: 1,
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('planted-prompt-secret'), false);
  assert.equal(serialized.includes('planted-response-secret'), false);
  assert.equal(serialized.includes('planted-api-key'), false);
  assert.equal(serialized.includes('byProvider'), false);
});

test('monitor lifecycle starts one unrefed interval and stops it idempotently', async () => {
  const repository = createAlertRepository(new Map([[1, [alert('daily', 100, false)]]]));
  let intervalCalls = 0;
  let clearCalls = 0;
  let unrefCalls = 0;
  const handle = {
    unref: () => {
      unrefCalls += 1;
    },
  } as unknown as ReturnType<typeof setInterval>;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: async () => usage('today', 0),
    notify: async () => true,
    setIntervalFn: ((callback: () => void, delay: number) => {
      assert.equal(typeof callback, 'function');
      assert.equal(delay, 5 * 60 * 1_000);
      intervalCalls += 1;
      return handle;
    }) as unknown as typeof setInterval,
    clearIntervalFn: ((received: ReturnType<typeof setInterval>) => {
      assert.equal(received, handle);
      clearCalls += 1;
    }) as unknown as typeof clearInterval,
  });

  monitor.start();
  monitor.start();
  await monitor.runOnce();
  monitor.stop();
  monitor.stop();

  assert.equal(intervalCalls, 1);
  assert.equal(unrefCalls, 1);
  assert.equal(clearCalls, 1);
});

test('stopping the monitor suppresses notifications from an in-flight cycle', async () => {
  const repository = createAlertRepository(new Map([[1, [alert('daily', 100)]]]));
  let releaseUsage: ((value: RoutingUsageView) => void) | null = null;
  let notifications = 0;
  const handle = { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
  const monitor = createRoutingUsageMonitor({
    repository,
    getUsage: () => new Promise((resolve) => {
      releaseUsage = resolve;
    }),
    notify: async () => {
      notifications += 1;
      return true;
    },
    setIntervalFn: (() => handle) as unknown as typeof setInterval,
    clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  });

  monitor.start();
  const cycle = monitor.runOnce();
  monitor.stop();
  assert.ok(releaseUsage);
  (releaseUsage as (value: RoutingUsageView) => void)(usage('today', 500));
  await cycle;

  assert.equal(notifications, 0);
  assert.equal(repository.listAlerts(1)[0].lastNotifiedPeriodKey, null);
});
