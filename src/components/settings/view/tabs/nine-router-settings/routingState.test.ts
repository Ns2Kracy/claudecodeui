import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyRoutingSettingsView } from '../../../../../../shared/routing.js';

import {
  accountDraftAfterMutation,
  connectionDraftAfterMutation,
  connectionDraftAfterCancel,
  createInitialRoutingState,
  createRoutingRequestCoordinator,
  routingStateReducer,
  shouldLoadRoutingDetails,
} from './routingState.js';

const safeError = {
  code: 'ROUTING_OPERATION_FAILED',
  message: 'The operation failed',
  status: 502,
  retryable: true,
};

test('routing state starts secret-free and loads aggregate settings', () => {
  const initial = createInitialRoutingState();
  const secretText = JSON.stringify(initial);
  assert.equal(secretText.includes('adminPassword'), false);
  assert.equal(secretText.includes('dataPlaneKey'), false);

  const settings = {
    ...emptyRoutingSettingsView(),
    routeSummary: { total: 3 },
  };
  const loaded = routingStateReducer(initial, { type: 'loadSucceeded', settings });
  assert.equal(loaded.loading, false);
  assert.equal(loaded.settings.routeSummary.total, 3);
  assert.equal(loaded.error, null);
});

test('expanded detail sections trigger one read until explicitly retried', () => {
  const initial = createInitialRoutingState();
  assert.equal(shouldLoadRoutingDetails(initial, ['accounts', 'routes']), true);

  const loading = routingStateReducer(initial, {
    type: 'detailsStarted',
    keys: ['accounts', 'routes'],
  });
  assert.equal(shouldLoadRoutingDetails(loading, ['accounts', 'routes']), false);

  const failed = routingStateReducer(loading, {
    type: 'detailsFailed',
    keys: ['accounts', 'routes'],
    error: safeError,
  });
  assert.equal(shouldLoadRoutingDetails(failed, ['accounts', 'routes']), false);

  const retryable = routingStateReducer(failed, {
    type: 'detailsReset',
    keys: ['accounts', 'routes'],
  });
  assert.equal(shouldLoadRoutingDetails(retryable, ['accounts', 'routes']), true);
});

test('request generations reject stale aggregate and pre-mutation detail responses', () => {
  const coordinator = createRoutingRequestCoordinator();
  const firstAggregate = coordinator.startAggregate();
  const currentAggregate = coordinator.startAggregate();
  assert.equal(coordinator.isCurrentAggregate(firstAggregate), false);
  assert.equal(coordinator.isCurrentAggregate(currentAggregate), true);

  const detailBeforeMutation = coordinator.startDetail();
  coordinator.invalidateReads();
  assert.equal(coordinator.isCurrentDetail(detailBeforeMutation), false);
  assert.equal(coordinator.isCurrentAggregate(currentAggregate), false);
});

test('detail loads merge data without discarding details loaded by another section', () => {
  const initial = createInitialRoutingState();
  const accountsLoaded = routingStateReducer(initial, {
    type: 'detailsSucceeded',
    keys: ['accounts'],
    settings: {
      ...emptyRoutingSettingsView(),
      accounts: [{
        id: 'account-1',
        provider: 'anthropic',
        name: 'Primary',
        authType: 'api_key',
        priority: 1,
        active: true,
        status: 'healthy',
        lastError: null,
        expiresAt: null,
      }],
    },
  });
  const usageLoaded = routingStateReducer(accountsLoaded, {
    type: 'detailsSucceeded',
    keys: ['usage:today'],
    settings: {
      ...emptyRoutingSettingsView(),
      usage: {
        period: 'today',
        requests: 4,
        promptTokens: 10,
        completionTokens: 5,
        estimatedCostMicrousd: 100,
        byProvider: [],
        staleAt: null,
      },
    },
  });

  assert.equal(usageLoaded.settings.accounts?.[0]?.id, 'account-1');
  assert.equal(usageLoaded.usageByPeriod.today?.requests, 4);

  const cleared = routingStateReducer(usageLoaded, { type: 'detailsCleared' });
  assert.equal(cleared.settings.accounts, undefined);
  assert.equal(cleared.settings.usage, undefined);
  assert.deepEqual(cleared.detailStatus, {});
  assert.deepEqual(cleared.usageByPeriod, {});
});

test('a late aggregate response cannot discard details that completed first', () => {
  const initial = createInitialRoutingState();
  const withAccounts = routingStateReducer(initial, {
    type: 'detailsSucceeded',
    keys: ['accounts'],
    settings: {
      ...emptyRoutingSettingsView(),
      accounts: [{
        id: 'account-new',
        provider: 'anthropic',
        name: 'Newest',
        authType: 'api_key',
        priority: null,
        active: true,
        status: 'healthy',
        lastError: null,
        expiresAt: null,
      }],
    },
  });
  const afterLateAggregate = routingStateReducer(withAccounts, {
    type: 'loadSucceeded',
    settings: {
      ...emptyRoutingSettingsView(),
      routeSummary: { total: 2 },
    },
  });

  assert.equal(afterLateAggregate.settings.accounts?.[0]?.id, 'account-new');
  assert.equal(afterLateAggregate.settings.routeSummary.total, 2);
  assert.equal(afterLateAggregate.detailStatus.accounts, 'loaded');
});

test('mutation state disables only the active operation and stores safe errors', () => {
  const initial = createInitialRoutingState();
  const running = routingStateReducer(initial, {
    type: 'mutationStarted',
    key: 'connection:save',
  });
  assert.equal(running.activeMutation, 'connection:save');
  assert.notEqual(running.activeMutation, 'binding:claude');

  const failed = routingStateReducer(running, {
    type: 'mutationFailed',
    error: safeError,
  });
  assert.equal(failed.activeMutation, null);
  assert.deepEqual(failed.error, safeError);
  assert.equal(failed.errorContext, 'mutation');
});

test('detail failures are identified separately so one inline retry state owns the error', () => {
  const failed = routingStateReducer(createInitialRoutingState(), {
    type: 'detailsFailed',
    keys: ['accounts', 'models'],
    error: safeError,
  });

  assert.equal(failed.errorContext, 'details');
  assert.equal(failed.detailStatus.accounts, 'error');
  assert.equal(failed.detailStatus.models, 'error');

  const mutationStarted = routingStateReducer(failed, {
    type: 'mutationStarted',
    key: 'account:create',
  });
  assert.equal(mutationStarted.errorContext, null);
});

test('successful connection mutation clears secrets while failure preserves user input', () => {
  const draft = {
    baseUrl: 'https://router.example',
    adminPassword: 'admin-secret',
    dataPlaneKey: 'data-plane-secret',
  };

  assert.equal(connectionDraftAfterMutation(draft, false), draft);
  assert.deepEqual(connectionDraftAfterMutation(draft, true, 'https://router.example'), {
    baseUrl: 'https://router.example',
    adminPassword: '',
    dataPlaneKey: '',
  });

  const accountDraft = {
    provider: 'anthropic',
    name: 'Primary',
    apiKey: 'account-secret',
    active: true,
  };
  assert.equal(accountDraftAfterMutation(accountDraft, false), accountDraft);
  assert.deepEqual(accountDraftAfterMutation(accountDraft, true), {
    ...accountDraft,
    apiKey: '',
  });
});

test('canceling a connection edit restores the persisted endpoint and clears secrets', () => {
  assert.deepEqual(connectionDraftAfterCancel('https://saved-router.example'), {
    baseUrl: 'https://saved-router.example',
    adminPassword: '',
    dataPlaneKey: '',
  });
});
