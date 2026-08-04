export const ROUTING_AGENTS = ['claude', 'codex', 'cursor', 'opencode'] as const;
export const ROUTING_SUPPORTED_AGENTS = ['claude', 'codex', 'opencode'] as const;

export type RoutingAgent = (typeof ROUTING_AGENTS)[number];
export type RoutingSupportedAgent = (typeof ROUTING_SUPPORTED_AGENTS)[number];
export type RoutingModelSource = 'native' | '9router';
export type RoutingConnectionStatus =
  | 'disconnected'
  | 'checking'
  | 'connected'
  | 'degraded'
  | 'offline';
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

export type RoutingConnectionView = {
  configured: boolean;
  baseUrl: string | null;
  status: RoutingConnectionStatus;
  version: string | null;
  hasAdminCredential: boolean;
  hasDataPlaneKey: boolean;
  secureStorageAvailable: boolean;
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
  connection: RoutingConnectionView;
  bindings: Record<RoutingAgent, RoutingBindingView>;
  accountSummary: { total: number; degraded: number };
  routeSummary: { total: number };
  accounts?: RoutingAccountView[];
  models?: RoutingModelView[];
  routes?: RoutingRouteView[];
  usage?: RoutingUsageView;
  usageAlerts: RoutingUsageAlertView[];
};

export type UpdateRoutingConnectionInput = {
  baseUrl: string;
  adminPassword?: string;
  dataPlaneKey?: string;
  clearAdminPassword?: boolean;
  clearDataPlaneKey?: boolean;
};

export type ValidateRoutingConnectionInput = UpdateRoutingConnectionInput;

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
    connection: {
      configured: false,
      baseUrl: null,
      status: 'disconnected',
      version: null,
      hasAdminCredential: false,
      hasDataPlaneKey: false,
      secureStorageAvailable: false,
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
