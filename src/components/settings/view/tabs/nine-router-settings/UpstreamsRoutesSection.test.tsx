import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstance } from 'i18next';
import React, { createElement, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  RoutingAccountView,
  RoutingCapabilities,
  RoutingModelView,
  RoutingRouteView,
} from '../../../../../../shared/routing.js';
import englishSettings from '../../../../../i18n/locales/en/settings.json' with { type: 'json' };

import AccountEditor from './AccountEditor.js';
import RouteEditor from './RouteEditor.js';
import UpstreamsRoutesSection from './UpstreamsRoutesSection.js';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const capabilities: RoutingCapabilities = {
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
};

const accounts: RoutingAccountView[] = [{
  id: 'oauth-account',
  provider: 'anthropic',
  name: 'Team OAuth',
  authType: 'oauth',
  priority: 2,
  active: true,
  status: 'healthy',
  lastError: null,
  expiresAt: '2030-01-02T03:04:05.000Z',
}];

const models: RoutingModelView[] = [
  { id: 'claude-sonnet', provider: 'anthropic', name: 'Claude Sonnet' },
  { id: 'gpt-codex', provider: 'openai', name: 'GPT Codex' },
];

const routes: RoutingRouteView[] = [{
  id: 'quality-route',
  name: 'quality-first',
  kind: 'combo',
  models: ['claude-sonnet', 'gpt-codex'],
}];

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

const mutationResult = async () => true;

test('collapsed disclosure summarizes accounts, degraded upstreams, and routes', async () => {
  const markup = await render(createElement(UpstreamsRoutesSection, {
    configured: true,
    connectionStatus: 'connected',
    capabilities,
    accountSummary: { total: 4, degraded: 2 },
    routeSummary: { total: 3 },
    accounts,
    models,
    routes,
    loading: false,
    detailsError: false,
    activeMutation: null,
    accountDraft: { provider: '', name: '', apiKey: '', active: true },
    onAccountFieldChange: () => {},
    onExpand: () => {},
    onRetry: () => {},
    onCreateAccount: mutationResult,
    onUpdateAccount: mutationResult,
    onTestAccount: mutationResult,
    onDeleteAccount: mutationResult,
    onCreateRoute: mutationResult,
    onUpdateRoute: mutationResult,
    onDeleteRoute: mutationResult,
  }));

  assert.match(markup, /4 accounts/);
  assert.match(markup, /2 need attention/);
  assert.match(markup, /3 routes/);
  assert.match(markup, /aria-expanded="false"/);
  assert.equal(markup.includes('role="tablist"'), false);
});

test('expanded detail failures render one inline retry state instead of editors', async () => {
  const markup = await render(createElement(UpstreamsRoutesSection, {
    configured: true,
    connectionStatus: 'connected',
    capabilities,
    accountSummary: { total: 1, degraded: 0 },
    routeSummary: { total: 1 },
    accounts,
    models,
    routes,
    loading: false,
    detailsError: true,
    activeMutation: null,
    accountDraft: { provider: '', name: '', apiKey: '', active: true },
    onAccountFieldChange: () => {},
    onExpand: () => {},
    onRetry: () => {},
    onCreateAccount: mutationResult,
    onUpdateAccount: mutationResult,
    onTestAccount: mutationResult,
    onDeleteAccount: mutationResult,
    onCreateRoute: mutationResult,
    onUpdateRoute: mutationResult,
    onDeleteRoute: mutationResult,
    defaultOpen: true,
  }));

  assert.equal((markup.match(/Could not load upstream accounts and routes/g) ?? []).length, 1);
  assert.match(markup, />Retry</);
  assert.equal(markup.includes('Team OAuth'), false);
  assert.equal(markup.includes('quality-first'), false);
});

test('account editor safely lists OAuth accounts but creates API-key accounts only', async () => {
  const markup = await render(createElement(AccountEditor, {
    accounts,
    models,
    canWrite: true,
    canTest: true,
    activeMutation: null,
    draft: { provider: 'anthropic', name: 'Primary', apiKey: '', active: true },
    onDraftFieldChange: () => {},
    onCreate: mutationResult,
    onUpdate: mutationResult,
    onTest: mutationResult,
    onDelete: mutationResult,
    defaultAdding: true,
    defaultDeleteId: 'oauth-account',
  }));

  assert.match(markup, /Team OAuth/);
  assert.match(markup, /OAuth/);
  assert.match(markup, /API-key accounts only/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /Delete Team OAuth\?/);
  assert.match(markup, />Confirm delete</);
  assert.equal(markup.includes('rawPayload'), false);
  assert.equal(markup.includes('request log'), false);
});

test('a saved account secret is absent whenever the add form is closed', async () => {
  const markup = await render(createElement(AccountEditor, {
    accounts,
    models,
    canWrite: true,
    canTest: true,
    activeMutation: null,
    draft: { provider: 'anthropic', name: 'Primary', apiKey: 'never-render-after-save', active: true },
    onDraftFieldChange: () => {},
    onCreate: mutationResult,
    onUpdate: mutationResult,
    onTest: mutationResult,
    onDelete: mutationResult,
  }));

  assert.equal(markup.includes('never-render-after-save'), false);
  assert.equal(markup.includes('type="password"'), false);
});

test('account test progress belongs only to the exact account mutation key', async () => {
  const markup = await render(createElement(AccountEditor, {
    accounts: [
      { ...accounts[0], id: 'account-1', name: 'Short ID' },
      { ...accounts[0], id: 'account-10', name: 'Long ID' },
    ],
    models,
    canWrite: true,
    canTest: true,
    activeMutation: 'account:test:account-10',
    draft: { provider: '', name: '', apiKey: '', active: true },
    onDraftFieldChange: () => {},
    onCreate: mutationResult,
    onUpdate: mutationResult,
    onTest: mutationResult,
    onDelete: mutationResult,
  }));

  assert.equal((markup.match(/animate-spin/g) ?? []).length, 1);
});

test('route editor exposes ordered accessible controls and confirmed deletion', async () => {
  const markup = await render(createElement(RouteEditor, {
    routes,
    models,
    boundRouteIds: new Set<string>(),
    canWrite: true,
    activeMutation: null,
    onCreate: mutationResult,
    onUpdate: mutationResult,
    onDelete: mutationResult,
    defaultEditingRouteId: 'quality-route',
    defaultDeleteId: 'quality-route',
  }));

  assert.match(markup, /Edit quality-first/);
  assert.match(markup, /aria-label="Move Claude Sonnet up"/);
  assert.match(markup, /aria-label="Move Claude Sonnet down"/);
  assert.match(markup, /aria-label="Remove Claude Sonnet"/);
  assert.match(markup, /Delete quality-first\?/);
  assert.match(markup, />Confirm delete</);
});
