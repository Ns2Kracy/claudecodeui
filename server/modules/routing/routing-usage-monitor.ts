import type { RoutingRepository, RoutingStoredAlert } from '@/shared/types.js';

import type {
  RoutingUsageAlertPeriod,
  RoutingUsagePeriod,
  RoutingUsageView,
} from '../../../shared/routing.js';

type UsageMonitorRepository = Pick<
  RoutingRepository,
  'listConnectionUserIds' | 'listAlerts' | 'markAlertNotified'
>;

type RoutingUsageThresholdEvent = {
  code: 'routing.usage.threshold';
  period: RoutingUsageAlertPeriod;
  usagePeriod: RoutingUsagePeriod;
  periodKey: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostMicrousd: number;
  thresholdMicrousd: number;
};

type IntervalHandle = ReturnType<typeof setInterval> & { unref?: () => void };

type RoutingUsageMonitorDependencies = {
  repository: UsageMonitorRepository;
  getUsage: (userId: number, period: RoutingUsagePeriod) => Promise<RoutingUsageView>;
  notify: (
    userId: number,
    event: RoutingUsageThresholdEvent,
  ) => Promise<boolean> | boolean;
  now?: () => Date;
  reportError?: (
    error: unknown,
    context: { userId?: number; period?: RoutingUsageAlertPeriod },
  ) => void;
  intervalMs?: number;
  concurrency?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

type UsageCheck = {
  userId: number;
  alert: RoutingStoredAlert;
  usagePeriod: RoutingUsagePeriod;
  periodKey: string;
};

const DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_CONCURRENCY = 3;

function usagePeriod(period: RoutingUsageAlertPeriod): RoutingUsagePeriod {
  return period === 'daily' ? 'today' : '30d';
}

function alertPeriodKey(period: RoutingUsageAlertPeriod, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `${period}:${day}`;
}

function thresholdEvent(check: UsageCheck, usage: RoutingUsageView): RoutingUsageThresholdEvent {
  return {
    code: 'routing.usage.threshold',
    period: check.alert.period,
    usagePeriod: check.usagePeriod,
    periodKey: check.periodKey,
    requests: usage.requests,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    estimatedCostMicrousd: usage.estimatedCostMicrousd,
    thresholdMicrousd: check.alert.thresholdMicrousd,
  };
}

function boundedConcurrency(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return DEFAULT_CONCURRENCY;
  return Number(value);
}

async function runBounded(
  checks: UsageCheck[],
  concurrency: number,
  runCheck: (check: UsageCheck) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < checks.length) {
      const index = nextIndex;
      nextIndex += 1;
      await runCheck(checks[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, checks.length) }, () => worker()),
  );
}

/**
 * Used by the routing module lifecycle and routing tests to poll advisory usage
 * thresholds without starting timers at import time or exposing raw usage data.
 */
export function createRoutingUsageMonitor(dependencies: RoutingUsageMonitorDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const reportError = dependencies.reportError ?? (() => {});
  const intervalMs = dependencies.intervalMs ?? DEFAULT_INTERVAL_MS;
  const concurrency = boundedConcurrency(dependencies.concurrency);
  const setIntervalFn = dependencies.setIntervalFn ?? setInterval;
  const clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;
  let timer: IntervalHandle | null = null;
  let inFlight: Promise<void> | null = null;
  let lifecycleEpoch = 0;

  const collectChecks = (): UsageCheck[] => {
    const checkedAt = now();
    const checks: UsageCheck[] = [];
    for (const userId of dependencies.repository.listConnectionUserIds()) {
      let alerts: RoutingStoredAlert[];
      try {
        alerts = dependencies.repository.listAlerts(userId);
      } catch (error) {
        reportError(error, { userId });
        continue;
      }
      for (const alert of alerts) {
        if (!alert.enabled) continue;
        const periodKey = alertPeriodKey(alert.period, checkedAt);
        if (alert.lastNotifiedPeriodKey === periodKey) continue;
        checks.push({
          userId,
          alert,
          usagePeriod: usagePeriod(alert.period),
          periodKey,
        });
      }
    }
    return checks;
  };

  const runCheck = async (check: UsageCheck, cycleEpoch: number): Promise<void> => {
    try {
      const currentUsage = await dependencies.getUsage(check.userId, check.usagePeriod);
      if (cycleEpoch !== lifecycleEpoch) return;
      if (currentUsage.staleAt) return;
      if (currentUsage.estimatedCostMicrousd < check.alert.thresholdMicrousd) return;
      const accepted = await dependencies.notify(
        check.userId,
        thresholdEvent(check, currentUsage),
      );
      if (cycleEpoch !== lifecycleEpoch || accepted !== true) return;
      dependencies.repository.markAlertNotified(
        check.userId,
        check.alert.period,
        check.periodKey,
      );
    } catch (error) {
      reportError(error, { userId: check.userId, period: check.alert.period });
    }
  };

  const runCycle = async (): Promise<void> => {
    const cycleEpoch = lifecycleEpoch;
    let checks: UsageCheck[];
    try {
      checks = collectChecks();
    } catch (error) {
      reportError(error, {});
      return;
    }
    await runBounded(checks, concurrency, (check) => runCheck(check, cycleEpoch));
  };

  const runOnce = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = runCycle().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    start(): void {
      if (timer) return;
      lifecycleEpoch += 1;
      void runOnce();
      timer = setIntervalFn(() => {
        void runOnce();
      }, intervalMs) as IntervalHandle;
      timer.unref?.();
    },
    stop(): void {
      if (!timer) return;
      clearIntervalFn(timer);
      timer = null;
      lifecycleEpoch += 1;
    },
    runOnce,
  };
}
