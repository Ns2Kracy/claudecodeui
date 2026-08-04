import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type {
  CreateRoutingApiKeyAccountInput,
  CreateRoutingRouteInput,
  RoutingAgent,
  RoutingSettingsView,
  RoutingUsageAlertPeriod,
  RoutingUsagePeriod,
  UpdateRoutingAccountInput,
  UpdateRoutingBindingInput,
  UpdateRoutingConnectionInput,
  UpdateRoutingRouteInput,
  UpdateRoutingUsageAlertInput,
  ValidateRoutingConnectionInput,
} from '../../../../../../shared/routing.js';

import { routingApi, RoutingApiError, type RoutingSettingsDetails } from './routingApi.js';
import {
  accountDraftAfterMutation,
  connectionDraftAfterMutation,
  createInitialRoutingState,
  createRoutingRequestCoordinator,
  routingStateReducer,
  shouldLoadRoutingDetails,
  type RoutingConnectionDraft,
  type RoutingAccountDraft,
  type RoutingDetailKey,
  type RoutingState,
  type RoutingUiError,
} from './routingState.js';

const UPSTREAM_DETAIL_KEYS: RoutingDetailKey[] = ['accounts', 'models', 'routes'];

function safeUiError(error: unknown): RoutingUiError {
  if (error instanceof RoutingApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.retryable,
    };
  }

  return {
    code: 'ROUTING_OPERATION_FAILED',
    message: 'The routing operation could not be completed.',
    status: 0,
    retryable: true,
  };
}

function loadedDetails(
  state: RoutingState,
  usagePeriod: RoutingUsagePeriod,
  required: RoutingSettingsDetails = {},
  includeLoading = false,
): RoutingSettingsDetails {
  const details: RoutingSettingsDetails = { ...required };
  const requested = (key: RoutingDetailKey) => (
    state.detailStatus[key] === 'loaded'
    || (includeLoading && state.detailStatus[key] === 'loading')
  );
  if (requested('accounts')) details.accounts = true;
  if (requested('models')) details.models = true;
  if (requested('routes')) details.routes = true;
  if (requested(`usage:${usagePeriod}`)) details.usage = usagePeriod;
  return details;
}

function detailKeysFor(details: RoutingSettingsDetails): RoutingDetailKey[] {
  const keys: RoutingDetailKey[] = [];
  if (details.accounts) keys.push('accounts');
  if (details.models) keys.push('models');
  if (details.routes) keys.push('routes');
  if (details.usage) keys.push(`usage:${details.usage}`);
  return keys;
}

function connectionInput(draft: RoutingConnectionDraft): UpdateRoutingConnectionInput {
  return {
    baseUrl: draft.baseUrl.trim(),
    ...(draft.adminPassword ? { adminPassword: draft.adminPassword } : {}),
    ...(draft.dataPlaneKey ? { dataPlaneKey: draft.dataPlaneKey } : {}),
  };
}

/** Owns all remote and write-only form state for the single Settings > 9Router page. */
export function useNineRouterSettings() {
  const [state, dispatch] = useReducer(routingStateReducer, undefined, createInitialRoutingState);
  const [connectionDraft, setConnectionDraft] = useState<RoutingConnectionDraft>({
    baseUrl: '',
    adminPassword: '',
    dataPlaneKey: '',
  });
  const [accountDraft, setAccountDraft] = useState<RoutingAccountDraft>({
    provider: '',
    name: '',
    apiKey: '',
    active: true,
  });
  const [usagePeriod, setUsagePeriod] = useState<RoutingUsagePeriod>('today');
  const stateRef = useRef(state);
  const usagePeriodRef = useRef(usagePeriod);
  const detailRequestsRef = useRef(new Set<RoutingDetailKey>());
  const mutationRef = useRef<string | null>(null);
  const requestCoordinatorRef = useRef(createRoutingRequestCoordinator());
  stateRef.current = state;
  usagePeriodRef.current = usagePeriod;

  const applySettings = useCallback((
    details: RoutingSettingsDetails,
    settings: RoutingSettingsView,
  ) => {
    const keys = detailKeysFor(details);
    dispatch(keys.length > 0
      ? { type: 'detailsSucceeded', keys, settings }
      : { type: 'loadSucceeded', settings });
  }, []);

  const loadSettings = useCallback(async () => {
    dispatch({ type: 'loadStarted' });
    const details = loadedDetails(
      stateRef.current,
      usagePeriodRef.current,
      {},
      true,
    );
    const token = requestCoordinatorRef.current.startAggregate();
    try {
      const settings = await routingApi.getSettings(details);
      if (!requestCoordinatorRef.current.isCurrentAggregate(token)) return;
      applySettings(details, settings);
      setConnectionDraft((current) => ({
        ...current,
        baseUrl: current.baseUrl || settings.connection.baseUrl || '',
      }));
    } catch (error) {
      if (!requestCoordinatorRef.current.isCurrentAggregate(token)) return;
      dispatch({ type: 'loadFailed', error: safeUiError(error) });
    }
  }, [applySettings]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const ensureDetails = useCallback(async (
    keys: RoutingDetailKey[],
    details: RoutingSettingsDetails,
    force = false,
  ) => {
    const pending = keys.filter((key) => (
      force
      || (
        stateRef.current.detailStatus[key] === undefined
        && !detailRequestsRef.current.has(key)
      )
    ));
    if (pending.length === 0 || (!force && !shouldLoadRoutingDetails(stateRef.current, pending))) {
      return;
    }

    for (const key of pending) detailRequestsRef.current.add(key);
    dispatch({ type: 'detailsStarted', keys: pending });
    const token = requestCoordinatorRef.current.startDetail();
    try {
      const settings = await routingApi.getSettings(details);
      if (!requestCoordinatorRef.current.isCurrentDetail(token)) return;
      dispatch({ type: 'detailsSucceeded', keys: pending, settings });
    } catch (error) {
      if (!requestCoordinatorRef.current.isCurrentDetail(token)) return;
      dispatch({ type: 'detailsFailed', keys: pending, error: safeUiError(error) });
    } finally {
      if (requestCoordinatorRef.current.isCurrentDetail(token)) {
        for (const key of pending) detailRequestsRef.current.delete(key);
      }
    }
  }, []);

  const ensureUpstreamDetails = useCallback(() => ensureDetails(
    UPSTREAM_DETAIL_KEYS,
    { accounts: true, models: true, routes: true },
  ), [ensureDetails]);

  const ensureRouteDetails = useCallback(() => ensureDetails(
    ['routes'],
    { routes: true },
  ), [ensureDetails]);

  const ensureUsage = useCallback((period: RoutingUsagePeriod) => {
    setUsagePeriod(period);
    return ensureDetails([`usage:${period}`], { usage: period });
  }, [ensureDetails]);

  const retryDetails = useCallback((
    keys: RoutingDetailKey[],
    details: RoutingSettingsDetails,
  ) => {
    for (const key of keys) detailRequestsRef.current.delete(key);
    dispatch({ type: 'detailsReset', keys });
    return ensureDetails(keys, details, true);
  }, [ensureDetails]);

  const retryUpstreamDetails = useCallback(() => retryDetails(
    UPSTREAM_DETAIL_KEYS,
    { accounts: true, models: true, routes: true },
  ), [retryDetails]);

  const retryRouteDetails = useCallback(() => retryDetails(
    ['routes'],
    { routes: true },
  ), [retryDetails]);

  const retryUsage = useCallback((period: RoutingUsagePeriod) => retryDetails(
    [`usage:${period}`],
    { usage: period },
  ), [retryDetails]);

  const refreshAfterMutation = useCallback(async (
    required: RoutingSettingsDetails = {},
    resetDetails = false,
  ) => {
    const details = resetDetails
      ? required
      : loadedDetails(stateRef.current, usagePeriodRef.current, required, true);
    const keys = detailKeysFor(details);
    const token = requestCoordinatorRef.current.startAggregate();
    try {
      const settings = await routingApi.getSettings(details);
      if (requestCoordinatorRef.current.isCurrentAggregate(token)) {
        applySettings(details, settings);
      }
      return settings;
    } catch (error) {
      for (const key of keys) detailRequestsRef.current.delete(key);
      if (keys.length > 0) dispatch({ type: 'detailsReset', keys });
      throw error;
    }
  }, [applySettings]);

  const runMutation = useCallback(async <T,>(
    key: string,
    operation: () => Promise<T>,
    requiredDetails: RoutingSettingsDetails = {},
    onOperationSuccess?: (result: T) => void,
    resetDetails = false,
  ): Promise<T | null> => {
    if (mutationRef.current) return null;
    mutationRef.current = key;
    dispatch({ type: 'mutationStarted', key });

    let result: T;
    try {
      result = await operation();
      const interruptedDetails = [...detailRequestsRef.current];
      detailRequestsRef.current.clear();
      requestCoordinatorRef.current.invalidateReads();
      if (interruptedDetails.length > 0) {
        dispatch({ type: 'detailsReset', keys: interruptedDetails });
      }
      onOperationSuccess?.(result);
    } catch (error) {
      mutationRef.current = null;
      dispatch({ type: 'mutationFailed', error: safeUiError(error) });
      return null;
    }

    try {
      await refreshAfterMutation(requiredDetails, resetDetails);
      dispatch({ type: 'mutationSucceeded' });
    } catch (error) {
      dispatch({ type: 'mutationFailed', error: safeUiError(error) });
    } finally {
      mutationRef.current = null;
    }
    return result;
  }, [refreshAfterMutation]);

  const connect = useCallback(() => runMutation(
    'connection:save',
    () => routingApi.connect(connectionInput(connectionDraft)),
    {},
    (connection) => {
      detailRequestsRef.current.clear();
      dispatch({ type: 'detailsCleared' });
      setConnectionDraft((current) => (
        connectionDraftAfterMutation(current, true, connection.baseUrl)
      ));
    },
    true,
  ), [connectionDraft, runMutation]);

  const validateConnection = useCallback((input?: ValidateRoutingConnectionInput) => runMutation(
    'connection:test',
    () => routingApi.validateConnection(input ?? connectionInput(connectionDraft)),
  ), [connectionDraft, runMutation]);

  const disconnect = useCallback(() => runMutation(
    'connection:disconnect',
    () => routingApi.disconnect(),
    {},
    () => {
      detailRequestsRef.current.clear();
      dispatch({ type: 'detailsCleared' });
      setConnectionDraft({ baseUrl: '', adminPassword: '', dataPlaneKey: '' });
    },
    true,
  ), [runMutation]);

  const setBinding = useCallback((provider: RoutingAgent, input: UpdateRoutingBindingInput) => (
    runMutation(`binding:${provider}`, () => routingApi.setBinding(provider, input))
  ), [runMutation]);

  const createAccount = useCallback((input: CreateRoutingApiKeyAccountInput = accountDraft) => runMutation(
    'account:create',
    () => routingApi.createAccount(input),
    { accounts: true, models: true, routes: true },
    () => setAccountDraft((current) => accountDraftAfterMutation(current, true)),
  ), [accountDraft, runMutation]);

  const updateAccount = useCallback((id: string, input: UpdateRoutingAccountInput) => runMutation(
    `account:update:${id}`,
    () => routingApi.updateAccount(id, input),
    { accounts: true, models: true, routes: true },
  ), [runMutation]);

  const testAccount = useCallback((id: string) => runMutation(
    `account:test:${id}`,
    () => routingApi.testAccount(id),
    { accounts: true },
  ), [runMutation]);

  const deleteAccount = useCallback((id: string) => runMutation(
    `account:delete:${id}`,
    () => routingApi.deleteAccount(id),
    { accounts: true, models: true, routes: true },
  ), [runMutation]);

  const createRoute = useCallback((input: CreateRoutingRouteInput) => runMutation(
    'route:create',
    () => routingApi.createRoute(input),
    { accounts: true, models: true, routes: true },
  ), [runMutation]);

  const updateRoute = useCallback((id: string, input: UpdateRoutingRouteInput) => runMutation(
    `route:update:${id}`,
    () => routingApi.updateRoute(id, input),
    { accounts: true, models: true, routes: true },
  ), [runMutation]);

  const deleteRoute = useCallback((id: string) => runMutation(
    `route:delete:${id}`,
    () => routingApi.deleteRoute(id),
    { accounts: true, models: true, routes: true },
  ), [runMutation]);

  const setUsageAlert = useCallback((
    period: RoutingUsageAlertPeriod,
    input: UpdateRoutingUsageAlertInput,
  ) => runMutation(
    `usage-alert:${period}`,
    () => routingApi.setUsageAlert(period, input),
  ), [runMutation]);

  const setConnectionField = useCallback((
    field: keyof RoutingConnectionDraft,
    value: string,
  ) => {
    setConnectionDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const setAccountField = useCallback(<Key extends keyof RoutingAccountDraft>(
    field: Key,
    value: RoutingAccountDraft[Key],
  ) => {
    setAccountDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'clearError' }), []);
  const isMutating = useCallback((key: string) => state.activeMutation === key, [state.activeMutation]);

  return {
    ...state,
    connectionDraft,
    setConnectionDraft,
    setConnectionField,
    accountDraft,
    setAccountDraft,
    setAccountField,
    usagePeriod,
    usage: state.usageByPeriod[usagePeriod] ?? null,
    setUsagePeriod: ensureUsage,
    loadSettings,
    ensureUpstreamDetails,
    ensureRouteDetails,
    ensureUsage,
    retryUpstreamDetails,
    retryRouteDetails,
    retryUsage,
    connect,
    validateConnection,
    disconnect,
    setBinding,
    createAccount,
    updateAccount,
    testAccount,
    deleteAccount,
    createRoute,
    updateRoute,
    deleteRoute,
    setUsageAlert,
    clearError,
    isMutating,
  };
}
