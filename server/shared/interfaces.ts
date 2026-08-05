import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  McpScope,
  NormalizedMessage,
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderAuthStatus,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderMcpServer,
  ProviderSkillCreateInput,
  ProviderSkillRemoveInput,
  ProviderRuntimeContext,
  ProviderRuntimePermissionGateway,
  ProviderRuntimeWriter,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';

import type {
  CreateRoutingApiKeyAccountInput,
  CreateRoutingRouteInput,
  CreateRoutingProviderNodeInput,
  RoutingAccountView,
  RoutingCapabilities,
  RoutingModelView,
  RoutingOAuthPollingStateView,
  RoutingProviderModelsView,
  RoutingProviderNodeValidationView,
  RoutingProviderNodeView,
  RoutingRouteView,
  RoutingUsagePeriod,
  RoutingUsageView,
  UpdateRoutingAccountInput,
  UpdateRoutingRouteInput,
  UpdateRoutingProviderNodeInput,
  ValidateRoutingProviderNodeInput,
} from '../../shared/routing.js';

//----------------- PROVIDER CONTRACT INTERFACES ------------

/**
 * Live execution contract implemented by each provider SDK/CLI adapter.
 *
 * The provider registry owns this adapter as one facet of `IProvider`; runtime
 * execution context is supplied by the application service at call time.
 */
export interface IProviderRuntime {
  run(
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown>;
  abort(sessionId: string): boolean | Promise<boolean>;
  permissions?: ProviderRuntimePermissionGateway;
}

/**
 * Main provider contract for CLI and SDK integrations.
 *
 * Each concrete provider owns its MCP/auth handlers plus the provider-specific
 * logic for converting native events/history into the app's normalized shape.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly runtime: IProviderRuntime;
  readonly models: IProviderModels;
  readonly mcp: IProviderMcp;
  readonly auth: IProviderAuth;
  readonly skills: IProviderSkills;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
}

// ---------------------------
//----------------- PROVIDER MODEL INTERFACE ------------
/**
 * Model catalog contract for one provider.
 *
 * Implementations are responsible for resolving the provider's currently
 * supported models and converting them into the shared
 * `ProviderModelsDefinition` shape used by backend routes and frontend model
 * pickers. The `DEFAULT` field should be the most appropriate default selection
 * for that provider at the time the catalog is read.
 */
export interface IProviderModels {
  /**
   * Returns the provider's currently supported model catalog.
   */
  getSupportedModels(): Promise<ProviderModelsDefinition>;

  /**
   * Reads the model the provider itself believes one session is running with.
   *
   * Only consulted for sessions the app has never recorded a model for — a
   * session started directly in the provider CLI, for example. Selecting a
   * model in the app is persisted on the session row instead, so adapters here
   * are read-only and must fall back to the catalog default when the
   * provider-specific lookup finds nothing.
   */
  getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel>;
}

// ---------------------------
//----------------- PROVIDER AUTH INTERFACE ------------
/**
 * Auth contract for one provider.
 *
 * Implementations should return a complete installation/authentication status
 * without throwing for normal "not installed" or "not authenticated" states.
 */
export interface IProviderAuth {
  /**
   * Checks whether the provider is installed and has usable credentials.
   */
  getStatus(): Promise<ProviderAuthStatus>;
}

// ---------------------------
//----------------- PROVIDER SKILLS INTERFACE ------------
/**
 * Skills contract for one provider.
 *
 * Implementations discover provider-native skill markdown locations and return
 * normalized skill records with the exact command syntax expected by that
 * provider. Each skill is read from a `SKILL.md` file under its skill directory.
 */
export interface IProviderSkills {
  /**
   * Lists all skills visible to this provider for the optional workspace.
   */
  listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]>;

  /**
   * Writes one or more global user-scoped skills for this provider.
   *
   * Implementations should install the supplied markdown entries into the
   * provider's writable user skill folder and return the normalized skill
   * records that were written.
   */
  addSkills(input: ProviderSkillCreateInput): Promise<ProviderSkill[]>;

  removeSkill(
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: LLMProvider; directoryName: string }>;
}

// ---------------------------
//----------------- PROVIDER MCP INTERFACE ------------
/**
 * MCP contract for one provider.
 *
 * Implementations must map provider-native MCP config formats to shared
 * `ProviderMcpServer` records used by routes and frontend state.
 */
export interface IProviderMcp {
  listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>>;
  listServersForScope(scope: McpScope, options?: { workspacePath?: string }): Promise<ProviderMcpServer[]>;
  upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer>;
  removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }>;
}

// ---------------------------
//----------------- PROVIDER SESSION INTERFACE ------------
/**
 * Session/history contract for one provider.
 *
 * Implementations normalize provider-specific events and message history into
 * shared transport shapes consumed by API routes and realtime streams.
 */
export interface IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult>;
}

// ---------------------------
//----------------- PROVIDER SESSION SYNCHRONIZER INTERFACE ------------
/**
 * Session indexing contract for one provider.
 *
 * Implementations scan provider-specific session artifacts on disk and upsert
 * normalized session metadata into the database. The service layer uses this
 * interface for both full rescans and single-file incremental sync triggered
 * by filesystem watcher events.
 */
export interface IProviderSessionSynchronizer {
  /**
   * Scans provider session artifacts and upserts discovered sessions into DB.
   */
  synchronize(since?: Date): Promise<number>;

  /**
   * Parses and upserts one provider artifact file without running a full scan.
   */
  synchronizeFile(filePath: string): Promise<string | null>;
}

// ---------------------------


/** Server-only OAuth authorize result from 9router. Service code must store codeVerifier and expose only safe fields to browsers. */
export type RoutingNineRouterOAuthStartInternalResult = {
  provider: string;
  authUrl: string;
  state: string;
  redirectUri: string;
  codeVerifier: string;
};

/** Server-only device-code result from 9router. Service code must store deviceCode, codeVerifier, and extraData and expose only safe fields to browsers. */
export type RoutingNineRouterDeviceCodeInternalResult = {
  provider: string;
  deviceCode: string;
  codeVerifier: string;
  extraData?: unknown;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number | null;
  interval: number | null;
};

/**
 * Server-only OAuth authorization-code exchange payload for 9router.
 *
 * Only routing services may construct this value after Task 8 adds durable
 * state/PKCE storage. It must never be exposed as a browser DTO because it
 * carries verifier material and redirect details required by upstream.
 */
export type RoutingNineRouterOAuthExchangeInternalInput = {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  state: string;
};

/**
 * Server-only OAuth device-code polling payload for 9router.
 *
 * Only routing services may construct this value from server-side device-code
 * state. Browser routes must use opaque transaction handles in Task 8 rather
 * than exposing deviceCode, codeVerifier, or upstream extraData fields.
 */
export type RoutingNineRouterOAuthPollInternalInput = {
  deviceCode: string;
  codeVerifier: string;
  extraData?: unknown;
};

// ---------------------------
//----------------- ROUTING CLIENT INTERFACE ------------
/**
 * Versioned 9router adapter contract implemented by `NineRouterClient`.
 *
 * Routing application/runtime services depend on this interface so tests can
 * supply deterministic fakes. Every return value is a sanitized CloudCLI DTO;
 * upstream payloads, dashboard cookies, and secret response fields are absent.
 */
export interface IRoutingNineRouterClient {
  validateConnection(): Promise<{
    version: string;
    knownVersion: boolean;
    capabilities: RoutingCapabilities;
  }>;
  listModels(): Promise<RoutingModelView[]>;
  listAccounts(): Promise<RoutingAccountView[]>;
  getProvider(id: string): Promise<RoutingAccountView>;
  listProviderModels(id: string): Promise<RoutingProviderModelsView>;
  startOAuth(provider: string, redirectUri: string): Promise<RoutingNineRouterOAuthStartInternalResult>;
  exchangeOAuth(provider: string, input: RoutingNineRouterOAuthExchangeInternalInput): Promise<RoutingAccountView>;
  startDeviceCode(provider: string): Promise<RoutingNineRouterDeviceCodeInternalResult>;
  pollDeviceCode(provider: string, input: RoutingNineRouterOAuthPollInternalInput): Promise<RoutingOAuthPollingStateView>;
  listProviderNodes(): Promise<RoutingProviderNodeView[]>;
  createProviderNode(input: CreateRoutingProviderNodeInput): Promise<RoutingProviderNodeView>;
  validateProviderNode(input: ValidateRoutingProviderNodeInput): Promise<RoutingProviderNodeValidationView>;
  updateProviderNode(id: string, input: UpdateRoutingProviderNodeInput): Promise<RoutingProviderNodeView>;
  deleteProviderNode(id: string): Promise<void>;
  createApiKeyAccount(input: CreateRoutingApiKeyAccountInput): Promise<RoutingAccountView>;
  updateAccount(id: string, input: UpdateRoutingAccountInput): Promise<RoutingAccountView>;
  deleteAccount(id: string): Promise<void>;
  testAccount(id: string): Promise<{
    healthy: boolean;
    error: string | null;
    refreshed: boolean;
  }>;
  listRoutes(): Promise<RoutingRouteView[]>;
  getRoute(id: string): Promise<RoutingRouteView>;
  createRoute(input: CreateRoutingRouteInput): Promise<RoutingRouteView>;
  updateRoute(id: string, input: UpdateRoutingRouteInput): Promise<RoutingRouteView>;
  deleteRoute(id: string): Promise<void>;
  getUsage(period: RoutingUsagePeriod): Promise<RoutingUsageView>;
}
