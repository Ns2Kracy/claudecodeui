import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstance } from 'i18next';
import React, { createElement, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';

import type { RoutingUsageAlertView, RoutingUsageView } from '../../../../../../shared/routing.js';
import englishSettings from '../../../../../i18n/locales/en/settings.json' with { type: 'json' };

import UsageLimitsSection from './UsageLimitsSection.js';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const usage: RoutingUsageView = {
  period: 'today',
  requests: 1_234,
  promptTokens: 8_765,
  completionTokens: 432,
  estimatedCostMicrousd: 12_345_678,
  byProvider: [
    { id: 'anthropic', requests: 900, costMicrousd: 10_000_000 },
    { id: 'openai', requests: 334, costMicrousd: 2_345_678 },
  ],
  staleAt: null,
};

const alerts: RoutingUsageAlertView[] = [
  { period: 'daily', enabled: true, thresholdMicrousd: 12_345_678 },
  { period: '30d', enabled: false, thresholdMicrousd: 50_000_000 },
];

async function render(element: ReactElement): Promise<string> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['settings'],
    defaultNS: 'settings',
    resources: { en: { settings: englishSettings } },
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
}

const baseProps = {
  configured: true,
  canReadUsage: true,
  usage,
  usagePeriod: 'today' as const,
  usageAlerts: alerts,
  loading: false,
  detailsError: false,
  activeMutation: null,
  onPeriodChange: () => {},
  onRetry: () => {},
  onSetAlert: async () => true,
};

test('usage dashboard renders exact totals, periods, and provider distribution', async () => {
  const markup = await render(createElement(UsageLimitsSection, baseProps));

  assert.match(markup, /Usage &amp; limits/);
  assert.match(markup, />Today</);
  assert.match(markup, />7 days</);
  assert.match(markup, />30 days</);
  assert.match(markup, /1,234/);
  assert.match(markup, /8,765/);
  assert.match(markup, /432/);
  assert.match(markup, /\$12\.345678/);
  assert.match(markup, /Anthropic/);
  assert.match(markup, /OpenAI/);
  assert.equal((markup.match(/role="progressbar"/g) ?? []).length, 2);
});

test('usage alerts render canonical decimal inputs and existing notification-channel guidance', async () => {
  const markup = await render(createElement(UsageLimitsSection, baseProps));

  assert.match(markup, /value="12\.345678"/);
  assert.match(markup, /value="50"/);
  assert.match(markup, /aria-checked="true"/);
  assert.match(markup, /existing notification channels/i);
  assert.match(markup, /Advisory only/i);
});

test('stale usage and failed requests render explicit non-empty states', async () => {
  const staleMarkup = await render(createElement(UsageLimitsSection, {
    ...baseProps,
    usage: { ...usage, staleAt: '2026-08-04T08:00:00.000Z' },
  }));
  const errorMarkup = await render(createElement(UsageLimitsSection, {
    ...baseProps,
    usage: null,
    detailsError: true,
  }));

  assert.match(staleMarkup, /cached snapshot/i);
  assert.match(errorMarkup, /Could not load 9Router usage/);
  assert.match(errorMarkup, />Retry</);
  assert.equal(errorMarkup.includes('No usage recorded'), false);
});

test('unconfigured and unsupported versions never imply that usage is zero', async () => {
  const connectMarkup = await render(createElement(UsageLimitsSection, {
    ...baseProps,
    configured: false,
    canReadUsage: false,
    usage: null,
  }));
  const unsupportedMarkup = await render(createElement(UsageLimitsSection, {
    ...baseProps,
    canReadUsage: false,
    usage: null,
  }));

  assert.match(connectMarkup, /runtime must be ready before usage and advisory limits can load/i);
  assert.match(unsupportedMarkup, /does not expose compatible usage data/i);
  assert.equal(`${connectMarkup}${unsupportedMarkup}`.includes('$0.00'), false);
});
