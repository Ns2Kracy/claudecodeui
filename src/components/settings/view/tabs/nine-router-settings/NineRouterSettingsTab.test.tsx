import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstance } from 'i18next';
import React, { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';

import { emptyRoutingSettingsView, type RoutingSettingsView } from '../../../../../../shared/routing.js';
import englishSettings from '../../../../../i18n/locales/en/settings.json' with { type: 'json' };

import { NineRouterSettingsTabView, isNineRouterRuntimeReady } from './NineRouterSettingsTab.js';
import type { RoutingErrorContext } from './routingState.js';

// npm test compiles TSX with the server's classic JSX transform. Some shared
// settings components use the browser's automatic transform and need this
// runtime binding when rendered through react-dom/server.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderRoutingView(
  settings: RoutingSettingsView,
  options: {
    error?: { code: string; message: string; status: number; retryable: boolean } | null;
    routesError?: boolean;
    errorContext?: RoutingErrorContext | null;
  } = {},
): Promise<string> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['settings'],
    defaultNS: 'settings',
    resources: { en: { settings: englishSettings } },
    interpolation: { escapeValue: false },
  });

  return renderToStaticMarkup(createElement(
    I18nextProvider,
    { i18n },
    createElement(NineRouterSettingsTabView, {
      settings,
      loading: false,
      error: options.error ?? null,
      errorContext: options.errorContext,
      activeMutation: null,
      routesError: options.routesError,
      onRestartRuntime: () => {},
      onSetBinding: () => {},
      onRetryRoutes: () => {},
      accountDraft: { provider: '', name: '', apiKey: '', active: true },
      onAccountFieldChange: () => {},
      onExpandUpstreamDetails: () => {},
      onRetryUpstreamDetails: () => {},
      onCreateAccount: async () => true,
      onUpdateAccount: async () => true,
      onTestAccount: async () => true,
      onDeleteAccount: async () => true,
      onCreateRoute: async () => true,
      onUpdateRoute: async () => true,
      onDeleteRoute: async () => true,
      usage: null,
      usagePeriod: 'today',
      onUsagePeriodChange: () => {},
      onRetryUsage: () => {},
      onSetUsageAlert: async () => true,
    }),
  ));
}

test('first render shows built-in runtime status and no connection controls', async () => {
  const settings = emptyRoutingSettingsView();
  const markup = await renderRoutingView(settings);

  assert.match(markup, /Built-in 9Router runtime/);
  assert.match(markup, /Unavailable/);
  assert.match(markup, />Restart runtime</);
  assert.equal(markup.includes('Endpoint'), false);
  assert.equal(markup.includes('Admin password'), false);
  assert.equal(markup.includes('Data-plane API key'), false);
  assert.equal(markup.includes('Test and connect'), false);
  assert.equal(markup.includes('Disconnect'), false);
  assert.equal(markup.includes('write-only'), false);
});

test('ready runtime enables route and usage sections and keeps native login messaging', async () => {
  const settings = emptyRoutingSettingsView();
  settings.runtime = {
    ...settings.runtime,
    status: 'ready',
    version: '0.5.45',
    capabilities: {
      readAccounts: true,
      writeApiKeyAccounts: true,
      testAccounts: true,
      readRoutes: true,
      writeRoutes: true,
      readUsage: true,
      claudeRuntime: true,
      codexRuntime: true,
      openCodeRuntime: true,
      cursorRuntime: false,
    },
  };
  settings.routes = [{ id: 'route-1', name: 'quality-first', kind: null, models: ['model-a'] }];
  settings.bindings.claude = {
    provider: 'claude', source: '9router', routeId: 'route-1', routeName: 'quality-first', supported: true,
  };

  const markup = await renderRoutingView(settings);

  assert.equal(markup.includes('never-render-admin'), false);
  assert.equal(markup.includes('never-render-key'), false);
  assert.match(markup, /Native login/);
  assert.match(markup, /9Router/);
  assert.match(markup, /Claude/);
  assert.match(markup, /Codex/);
  assert.match(markup, /OpenCode/);
  assert.match(markup, /Cursor is native-only/);
  assert.match(markup, /Usage &amp; limits/);
  assert.match(markup, /Advisory alerts/);
  assert.equal(markup.includes('role="tablist"'), false);
});

test('renders unavailable, unauthorized, and incompatible runtime states inline', async () => {
  const unavailable = emptyRoutingSettingsView();
  unavailable.runtime = {
    ...unavailable.runtime,
    status: 'unavailable',
    lastError: { code: 'ROUTING_RUNTIME_UNAVAILABLE', message: 'Runtime failed', retryable: true },
  };

  const unauthorized = emptyRoutingSettingsView();
  unauthorized.runtime.status = 'ready';
  const incompatible = emptyRoutingSettingsView();
  incompatible.runtime = {
    ...incompatible.runtime,
    status: 'degraded',
    version: '99.0.0',
    lastError: { code: 'ROUTING_VERSION_UNSUPPORTED', message: 'Unsupported', retryable: false },
  };

  const markup = [
    await renderRoutingView(unavailable),
    await renderRoutingView(unauthorized, {
      error: { code: 'ROUTING_UNAUTHORIZED', message: 'Unauthorized', status: 401, retryable: false },
    }),
    await renderRoutingView(incompatible),
  ].join('\n');

  assert.match(markup, /Built-in 9Router runtime is unavailable/);
  assert.match(markup, /9Router credentials were rejected/);
  assert.match(markup, /This 9Router version has limited compatibility/);
});

test('degraded runtime keeps status visible but does not render ready-only detail controls', async () => {
  const settings = emptyRoutingSettingsView();
  settings.runtime = {
    ...settings.runtime,
    status: 'degraded',
    version: '0.5.45',
    capabilities: {
      readAccounts: true,
      writeApiKeyAccounts: true,
      testAccounts: true,
      readRoutes: true,
      writeRoutes: true,
      readUsage: true,
      claudeRuntime: true,
      codexRuntime: true,
      openCodeRuntime: true,
      cursorRuntime: false,
    },
    lastError: { code: 'ROUTING_PROCESS_FAILED', message: 'Runtime health check failed', retryable: true },
  };
  settings.routes = [{ id: 'route-1', name: 'quality-first', kind: null, models: ['model-a'] }];

  const markup = await renderRoutingView(settings);

  assert.match(markup, /Degraded/);
  assert.match(markup, /Runtime health check failed/);
  assert.equal(markup.includes('Advisory alerts'), false);
  assert.equal(markup.includes('Create API-key account'), false);
  assert.equal(markup.includes('Create route'), false);
});

test('degraded runtime is not eligible for automatic accounts, routes, or usage detail reads', () => {
  const settings = emptyRoutingSettingsView();
  settings.runtime = {
    ...settings.runtime,
    status: 'degraded',
    capabilities: {
      ...settings.runtime.capabilities,
      readAccounts: true,
      readRoutes: true,
      readUsage: true,
    },
  };

  assert.equal(isNineRouterRuntimeReady(settings), false);

  settings.runtime.status = 'ready';
  assert.equal(isNineRouterRuntimeReady(settings), true);
});


test('route loading failures are retryable and are not mislabeled as an empty route list', async () => {
  const settings = emptyRoutingSettingsView();
  settings.runtime = {
    ...settings.runtime,
    status: 'ready',
    capabilities: { ...settings.runtime.capabilities, readRoutes: true },
  };

  const markup = await renderRoutingView(settings, {
    routesError: true,
    errorContext: 'details',
    error: {
      code: 'ROUTING_ROUTES_FAILED',
      message: 'Could not load route details',
      status: 502,
      retryable: true,
    },
  });

  assert.match(markup, /Could not load 9Router routes/);
  assert.equal((markup.match(/Could not load 9Router routes/g) ?? []).length, 1);
  assert.match(markup, />Retry</);
  assert.equal(markup.includes('9Router operation failed'), false);
  assert.equal(markup.includes('Could not load route details'), false);
  assert.equal(markup.includes('Create a route in 9Router'), false);
});
