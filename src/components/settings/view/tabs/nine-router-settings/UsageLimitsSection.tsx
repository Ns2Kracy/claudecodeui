import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Coins,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  RoutingUsageAlertPeriod,
  RoutingUsageAlertView,
  RoutingUsagePeriod,
  RoutingUsageView,
  UpdateRoutingUsageAlertInput,
} from '../../../../../../shared/routing.js';
import { Button, Input } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

import {
  formatMicrousdInput,
  parseUsdToMicrousd,
  providerDistribution,
} from './usageState.js';

type UsageLimitsSectionProps = {
  configured: boolean;
  canReadUsage: boolean;
  usage: RoutingUsageView | null;
  usagePeriod: RoutingUsagePeriod;
  usageAlerts: RoutingUsageAlertView[];
  loading: boolean;
  detailsError: boolean;
  activeMutation: string | null;
  onPeriodChange: (period: RoutingUsagePeriod) => void;
  onRetry: () => void;
  onSetAlert: (
    period: RoutingUsageAlertPeriod,
    input: UpdateRoutingUsageAlertInput,
  ) => Promise<boolean>;
};

type AlertDraft = {
  enabled: boolean;
  thresholdUsd: string;
};

type AlertDrafts = Record<RoutingUsageAlertPeriod, AlertDraft>;

const USAGE_PERIODS: RoutingUsagePeriod[] = ['today', '7d', '30d'];
const ALERT_PERIODS: RoutingUsageAlertPeriod[] = ['daily', '30d'];

function alertDrafts(alerts: RoutingUsageAlertView[]): AlertDrafts {
  const draftFor = (period: RoutingUsageAlertPeriod): AlertDraft => {
    const alert = alerts.find((item) => item.period === period);
    return {
      enabled: alert?.enabled ?? false,
      thresholdUsd: formatMicrousdInput(alert?.thresholdMicrousd ?? 0),
    };
  };
  return {
    daily: draftFor('daily'),
    '30d': draftFor('30d'),
  };
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatMicrousd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value / 1_000_000);
}

function providerName(id: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    gemini: 'Gemini',
    'azure-openai': 'Azure OpenAI',
  };
  return known[id.toLowerCase()] ?? id;
}

export default function UsageLimitsSection({
  configured,
  canReadUsage,
  usage,
  usagePeriod,
  usageAlerts,
  loading,
  detailsError,
  activeMutation,
  onPeriodChange,
  onRetry,
  onSetAlert,
}: UsageLimitsSectionProps) {
  const { t } = useTranslation('settings');
  const [drafts, setDrafts] = useState<AlertDrafts>(() => alertDrafts(usageAlerts));
  const [alertErrors, setAlertErrors] = useState<Partial<Record<RoutingUsageAlertPeriod, string>>>({});
  const distribution = useMemo(
    () => (usage ? providerDistribution(usage) : null),
    [usage],
  );
  const mutationBusy = activeMutation !== null;
  const dailyAlert = usageAlerts.find((item) => item.period === 'daily');
  const rollingAlert = usageAlerts.find((item) => item.period === '30d');
  const dailyEnabled = dailyAlert?.enabled ?? false;
  const dailyThreshold = dailyAlert?.thresholdMicrousd ?? 0;
  const rollingEnabled = rollingAlert?.enabled ?? false;
  const rollingThreshold = rollingAlert?.thresholdMicrousd ?? 0;

  useEffect(() => {
    setDrafts({
      daily: {
        enabled: dailyEnabled,
        thresholdUsd: formatMicrousdInput(dailyThreshold),
      },
      '30d': {
        enabled: rollingEnabled,
        thresholdUsd: formatMicrousdInput(rollingThreshold),
      },
    });
  }, [dailyEnabled, dailyThreshold, rollingEnabled, rollingThreshold]);

  const updateAlertDraft = (
    period: RoutingUsageAlertPeriod,
    update: Partial<AlertDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [period]: { ...current[period], ...update },
    }));
    setAlertErrors((current) => ({ ...current, [period]: undefined }));
  };

  const saveAlert = async (period: RoutingUsageAlertPeriod) => {
    const thresholdMicrousd = parseUsdToMicrousd(drafts[period].thresholdUsd);
    if (thresholdMicrousd === null) {
      setAlertErrors((current) => ({
        ...current,
        [period]: t('nineRouter.usage.alerts.invalidThreshold'),
      }));
      return;
    }
    await onSetAlert(period, {
      enabled: drafts[period].enabled,
      thresholdMicrousd,
    });
  };

  return (
    <SettingsSection
      title={t('nineRouter.usage.title')}
      description={t('nineRouter.usage.description')}
    >
      <div className="space-y-4">
        <SettingsCard>
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                <BarChart3 className="h-4 w-4" />
              </span>
              <div>
                <h4 className="text-sm font-medium text-foreground">
                  {t('nineRouter.usage.dashboard.title')}
                </h4>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('nineRouter.usage.dashboard.estimate')}
                </p>
              </div>
            </div>

            {configured && canReadUsage && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRetry}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t('nineRouter.usage.actions.refresh')}
              </Button>
            )}
          </div>

          {!configured && (
            <p className="p-4 text-sm text-muted-foreground">
              {t('nineRouter.usage.connectFirst')}
            </p>
          )}

          {configured && !canReadUsage && (
            <div className="flex gap-2 p-4 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{t('nineRouter.usage.unavailable')}</p>
            </div>
          )}

          {configured && canReadUsage && (
            <div className="space-y-5 p-4">
              <div
                role="group"
                aria-label={t('nineRouter.usage.periodLabel')}
                className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
              >
                {USAGE_PERIODS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    aria-pressed={usagePeriod === period}
                    onClick={() => onPeriodChange(period)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      usagePeriod === period
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(`nineRouter.usage.periods.${period}`)}
                  </button>
                ))}
              </div>

              {detailsError && (
                <div role="alert" className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-foreground">
                    {t('nineRouter.usage.loadFailed')}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={loading}>
                    <RefreshCw className="h-4 w-4" />
                    {t('nineRouter.usage.actions.retry')}
                  </Button>
                </div>
              )}

              {loading && !usage && (
                <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  {t('nineRouter.usage.loading')}
                </div>
              )}

              {!loading && !detailsError && !usage && (
                <p className="py-4 text-sm text-muted-foreground">
                  {t('nineRouter.usage.empty')}
                </p>
              )}

              {usage && (
                <>
                  {(usage.staleAt || detailsError) && (
                    <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p>{t('nineRouter.usage.stale')}</p>
                    </div>
                  )}

                  <dl className="grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['requests', formatInteger(usage.requests)],
                      ['promptTokens', formatInteger(usage.promptTokens)],
                      ['completionTokens', formatInteger(usage.completionTokens)],
                      ['estimatedCost', formatMicrousd(usage.estimatedCostMicrousd)],
                    ].map(([key, value], index) => (
                      <div
                        key={key}
                        className={`p-3 ${index > 0 ? 'border-t border-border sm:border-l sm:border-t-0' : ''} ${index === 2 ? 'sm:border-l-0 sm:border-t lg:border-l lg:border-t-0' : ''}`}
                      >
                        <dt className="text-xs text-muted-foreground">
                          {t(`nineRouter.usage.metrics.${key}`)}
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h5 className="text-sm font-medium text-foreground">
                        {t('nineRouter.usage.providers.title')}
                      </h5>
                      {distribution && distribution.rows.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t(`nineRouter.usage.providers.basis.${distribution.basis}`)}
                        </span>
                      )}
                    </div>

                    {distribution?.rows.length ? (
                      <div className="space-y-3">
                        {distribution.rows.map((provider) => (
                          <div key={provider.id} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="truncate font-medium text-foreground">
                                {providerName(provider.id)}
                              </span>
                              <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                                {distribution.basis === 'cost'
                                  ? formatMicrousd(provider.costMicrousd)
                                  : t('nineRouter.usage.providers.requests', {
                                      count: provider.requests,
                                      formattedCount: formatInteger(provider.requests),
                                    })}
                                {' · '}{provider.percent.toFixed(1)}%
                              </span>
                            </div>
                            <div
                              role="progressbar"
                              aria-label={t('nineRouter.usage.providers.share', {
                                provider: providerName(provider.id),
                              })}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Number(provider.percent.toFixed(1))}
                              className="h-1.5 overflow-hidden rounded-full bg-muted"
                            >
                              <div
                                className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
                                style={{ width: `${provider.percent}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t('nineRouter.usage.providers.empty')}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </SettingsCard>

        {configured && canReadUsage && (
          <SettingsCard>
            <div className="flex items-start gap-3 border-b border-border p-4">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                <BellRing className="h-4 w-4" />
              </span>
              <div>
                <h4 className="text-sm font-medium text-foreground">
                  {t('nineRouter.usage.alerts.title')}
                </h4>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t('nineRouter.usage.alerts.description')}
                </p>
              </div>
            </div>

            <div className="divide-y divide-border">
              {ALERT_PERIODS.map((period) => {
                const mutationKey = `usage-alert:${period}`;
                const saving = activeMutation === mutationKey;
                const inputId = `nine-router-usage-alert-${period}`;
                return (
                  <div key={period} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Coins className="h-4 w-4 text-muted-foreground" />
                        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
                          {t(`nineRouter.usage.alerts.periods.${period}`)}
                        </label>
                      </div>
                      <div className="max-w-xs">
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                            $
                          </span>
                          <Input
                            id={inputId}
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={drafts[period].thresholdUsd}
                            onChange={(event) => updateAlertDraft(period, {
                              thresholdUsd: event.target.value,
                            })}
                            aria-invalid={Boolean(alertErrors[period])}
                            aria-describedby={`${inputId}-help${alertErrors[period] ? ` ${inputId}-error` : ''}`}
                            disabled={mutationBusy}
                            className="pl-7 pr-12 tabular-nums"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                            USD
                          </span>
                        </div>
                        <p id={`${inputId}-help`} className="mt-1.5 text-xs text-muted-foreground">
                          {t('nineRouter.usage.alerts.thresholdHelp')}
                        </p>
                        {alertErrors[period] && (
                          <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs text-destructive">
                            {alertErrors[period]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <SettingsToggle
                        checked={drafts[period].enabled}
                        onChange={(enabled) => updateAlertDraft(period, { enabled })}
                        ariaLabel={t('nineRouter.usage.alerts.toggle', {
                          period: t(`nineRouter.usage.alerts.periods.${period}`),
                        })}
                        disabled={mutationBusy}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { void saveAlert(period); }}
                        disabled={mutationBusy}
                      >
                        {saving && (
                          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        )}
                        {saving
                          ? t('nineRouter.usage.actions.saving')
                          : t('nineRouter.usage.actions.save')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {t('nineRouter.usage.alerts.advisory')}
            </div>
          </SettingsCard>
        )}
      </div>
    </SettingsSection>
  );
}
