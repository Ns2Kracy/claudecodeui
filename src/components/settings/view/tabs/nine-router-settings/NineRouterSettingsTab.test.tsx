import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstance } from 'i18next';
import React, { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';

import { emptyRoutingSettingsView, type RoutingSettingsView } from '../../../../../../shared/routing.js';
import englishSettings from '../../../../../i18n/locales/en/settings.json' with { type: 'json' };

import { NineRouterSettingsTabView } from './NineRouterSettingsTab.js';

// npm test compiles TSX with the server's classic JSX transform. Some shared
// settings components use the browser's automatic transform and need this
// runtime binding when rendered through react-dom/server.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderRoutingView(
  settings: RoutingSettingsView,
  options: {
    error?: { code: string; message: string; status: number; retryable: boolean } | null;
    secrets?: { adminPassword: string; dataPlaneKey: string };
    routesError?: boolean;
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
      activeMutation: null,
      routesError: options.routesError,
      connectionDraft: {
        baseUrl: settings.connection.baseUrl ?? '',
        adminPassword: options.secrets?.adminPassword ?? '',
        dataPlaneKey: options.secrets?.dataPlaneKey ?? '',
      },
      onConnectionFieldChange: () => {},
      onCancelConnectionEdit: () => {},
      onConnect: async () => true,
      onValidateConnection: () => {},
      onDisconnect: () => {},
      onSetBinding: () => {},
      onRetryRoutes: () => {},
    }),
  ));
}

test('unconfigured state renders write-only connection fields and one connect action', async () => {
  const settings = emptyRoutingSettingsView();
  settings.connection.secureStorageAvailable = true;
  const markup = await renderRoutingView(settings);

  assert.match(markup, />Endpoint</);
  assert.match(markup, />Admin password</);
  assert.match(markup, />Data-plane API key</);
  assert.match(markup, />Test and connect</);
  assert.equal((markup.match(/type="password"/g) ?? []).length, 2);
  assert.match(markup, /HTTPS/);
  assert.match(markup, /write-only/i);
});

test('connected state never renders secrets and keeps agents separate from model source', async () => {
  const settings = emptyRoutingSettingsView();
  settings.connection = {
    ...settings.connection,
    configured: true,
    baseUrl: 'https://router.example',
    status: 'connected',
    version: '0.5.45',
    hasAdminCredential: true,
    hasDataPlaneKey: true,
    secureStorageAvailable: true,
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

  const markup = await renderRoutingView(settings, {
    secrets: { adminPassword: 'never-render-admin', dataPlaneKey: 'never-render-key' },
  });

  assert.equal(markup.includes('never-render-admin'), false);
  assert.equal(markup.includes('never-render-key'), false);
  assert.match(markup, /Native login/);
  assert.match(markup, /9Router/);
  assert.match(markup, /Claude/);
  assert.match(markup, /Codex/);
  assert.match(markup, /OpenCode/);
  assert.match(markup, /Cursor is native-only/);
  assert.equal(markup.includes('role="tablist"'), false);
});

test('renders secure-storage, offline, unauthorized, and incompatible states inline', async () => {
  const secureStorage = emptyRoutingSettingsView();
  secureStorage.connection.secureStorageAvailable = false;

  const offline = emptyRoutingSettingsView();
  offline.connection = {
    ...offline.connection,
    configured: true,
    secureStorageAvailable: true,
    status: 'offline',
    lastError: { code: 'ROUTING_OFFLINE', message: 'Offline', retryable: true },
  };

  const unauthorized = emptyRoutingSettingsView();
  unauthorized.connection.secureStorageAvailable = true;
  const incompatible = emptyRoutingSettingsView();
  incompatible.connection = {
    ...incompatible.connection,
    configured: true,
    secureStorageAvailable: true,
    status: 'degraded',
    version: '99.0.0',
    lastError: { code: 'ROUTING_VERSION_UNSUPPORTED', message: 'Unsupported', retryable: false },
  };

  const markup = [
    await renderRoutingView(secureStorage),
    await renderRoutingView(offline),
    await renderRoutingView(unauthorized, {
      error: { code: 'ROUTING_UNAUTHORIZED', message: 'Unauthorized', status: 401, retryable: false },
    }),
    await renderRoutingView(incompatible),
  ].join('\n');

  assert.match(markup, /Secure storage is unavailable/);
  assert.match(markup, /9Router is offline/);
  assert.match(markup, /9Router credentials were rejected/);
  assert.match(markup, /This 9Router version has limited compatibility/);
});

test('route loading failures are retryable and are not mislabeled as an empty route list', async () => {
  const settings = emptyRoutingSettingsView();
  settings.connection = {
    ...settings.connection,
    configured: true,
    secureStorageAvailable: true,
    capabilities: { ...settings.connection.capabilities, readRoutes: true },
  };

  const markup = await renderRoutingView(settings, {
    routesError: true,
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
