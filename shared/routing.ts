export const ROUTING_AGENTS = ['claude', 'codex', 'cursor', 'opencode'] as const;
export const ROUTING_SUPPORTED_AGENTS = ['claude', 'codex', 'opencode'] as const;
export const ROUTING_ROUTE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export type RoutingAgent = (typeof ROUTING_AGENTS)[number];
export type RoutingSupportedAgent = (typeof ROUTING_SUPPORTED_AGENTS)[number];
export type RoutingModelSource = 'native' | '9router';
export type RoutingRuntimeStatus = 'starting' | 'ready' | 'degraded' | 'unavailable';
export type RoutingUsagePeriod = 'today' | '7d' | '30d';
export type RoutingUsageAlertPeriod = 'daily' | '30d';

export type RoutingSafeError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type RoutingCapabilities = {
  readAccounts: boolean;
  writeApiKeyAccounts: boolean;
  testAccounts: boolean;
  readRoutes: boolean;
  writeRoutes: boolean;
  readUsage: boolean;
  claudeRuntime: boolean;
  codexRuntime: boolean;
  openCodeRuntime: boolean;
  cursorRuntime: false;
};

export type RoutingRuntimeView = {
  mode: 'embedded';
  status: RoutingRuntimeStatus;
  version: string | null;
  lastCheckedAt: string | null;
  lastError: RoutingSafeError | null;
  capabilities: RoutingCapabilities;
};

export type RoutingBindingView = {
  provider: RoutingAgent;
  source: RoutingModelSource;
  routeId: string | null;
  routeName: string | null;
  supported: boolean;
};

export type RoutingAccountView = {
  id: string;
  provider: string;
  name: string;
  authType: string;
  priority: number | null;
  active: boolean;
  status: 'healthy' | 'cooling' | 'limited' | 'failed' | 'unknown';
  lastError: string | null;
  expiresAt: string | null;
};

export type RoutingModelView = {
  id: string;
  provider: string;
  name: string;
};

export type RoutingRouteView = {
  id: string;
  name: string;
  kind: string | null;
  models: string[];
};

export type RoutingUsageView = {
  period: RoutingUsagePeriod;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostMicrousd: number;
  byProvider: Array<{ id: string; requests: number; costMicrousd: number }>;
  staleAt: string | null;
};

export type RoutingUsageAlertView = {
  period: RoutingUsageAlertPeriod;
  enabled: boolean;
  thresholdMicrousd: number;
};

export type RoutingSettingsView = {
  runtime: RoutingRuntimeView;
  bindings: Record<RoutingAgent, RoutingBindingView>;
  accountSummary: { total: number; degraded: number };
  routeSummary: { total: number };
  accounts?: RoutingAccountView[];
  models?: RoutingModelView[];
  routes?: RoutingRouteView[];
  usage?: RoutingUsageView;
  usageAlerts: RoutingUsageAlertView[];
};


export type RoutingProviderConnectionMethod = 'api_key' | 'oauth' | 'device_code' | 'custom';

export type RoutingOAuthStartView = {
  provider: string;
  authUrl: string;
  state: string;
  redirectUri: string;
};

export type RoutingDeviceCodeChallengeView = {
  provider: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number | null;
  interval: number | null;
};

export type RoutingOAuthPollingStateView = {
  provider: string;
  pending: boolean;
  account: RoutingAccountView | null;
};

export type RoutingProviderModelsView = {
  provider: string;
  connectionId: string;
  models: RoutingModelView[];
};

export type RoutingProviderNodeView = {
  id: string;
  name: string;
  baseUrl: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CreateRoutingProviderNodeInput = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  active?: boolean;
};

export type UpdateRoutingProviderNodeInput = {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  active?: boolean;
};

export type ValidateRoutingProviderNodeInput = {
  baseUrl: string;
  apiKey?: string;
};

export type RoutingProviderNodeValidationView = {
  valid: boolean;
  message: string | null;
};

export type CreateRoutingApiKeyAccountInput = {
  provider: string;
  name: string;
  apiKey: string;
  priority?: number;
  active?: boolean;
};

export type UpdateRoutingAccountInput = {
  name?: string;
  apiKey?: string;
  priority?: number;
  active?: boolean;
};

export type CreateRoutingRouteInput = {
  name: string;
  models: string[];
  kind?: string | null;
};

export type UpdateRoutingRouteInput = {
  name?: string;
  models?: string[];
  kind?: string | null;
};

export type UpdateRoutingBindingInput = {
  source: RoutingModelSource;
  routeId?: string | null;
};

export type UpdateRoutingUsageAlertInput = {
  enabled: boolean;
  thresholdMicrousd: number;
};

const EMPTY_CAPABILITIES: RoutingCapabilities = {
  readAccounts: false,
  writeApiKeyAccounts: false,
  testAccounts: false,
  readRoutes: false,
  writeRoutes: false,
  readUsage: false,
  claudeRuntime: false,
  codexRuntime: false,
  openCodeRuntime: false,
  cursorRuntime: false,
};

function nativeBinding(provider: RoutingAgent): RoutingBindingView {
  return {
    provider,
    source: 'native',
    routeId: null,
    routeName: null,
    supported: provider !== 'cursor',
  };
}

export function emptyRoutingSettingsView(): RoutingSettingsView {
  return {
    runtime: {
      mode: 'embedded',
      status: 'unavailable',
      version: null,
      lastCheckedAt: null,
      lastError: null,
      capabilities: { ...EMPTY_CAPABILITIES },
    },
    bindings: {
      claude: nativeBinding('claude'),
      codex: nativeBinding('codex'),
      cursor: nativeBinding('cursor'),
      opencode: nativeBinding('opencode'),
    },
    accountSummary: { total: 0, degraded: 0 },
    routeSummary: { total: 0 },
    usageAlerts: [],
  };
}
