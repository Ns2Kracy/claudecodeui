export const ROUTING_AGENTS = [
	"claude",
	"codex",
	"cursor",
	"opencode",
] as const;

export type RoutingAgent = (typeof ROUTING_AGENTS)[number];
export type RoutingRuntimeStatus =
	| "starting"
	| "ready"
	| "degraded"
	| "unavailable";

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
	mode: "sidecar";
	status: RoutingRuntimeStatus;
	version: string | null;
	lastCheckedAt: string | null;
	lastError: RoutingSafeError | null;
	capabilities: RoutingCapabilities;
};

export type RoutingAccountView = {
	id: string;
	provider: string;
	name: string;
	authType: string;
	priority: number | null;
	active: boolean;
	status: "healthy" | "cooling" | "limited" | "failed" | "unknown";
	lastError: string | null;
	expiresAt: string | null;
};

export type RoutingModelView = {
	id: string;
	provider: string;
	name: string;
};

export type RoutingSettingsView = {
	runtime: RoutingRuntimeView;
	accountSummary: { total: number; degraded: number };
	accounts?: RoutingAccountView[];
	models?: RoutingModelView[];
};

export type RoutingProviderConnectionMethod =
	| "api_key"
	| "oauth"
	| "device_code"
	| "custom";

export type RoutingOAuthStartView = {
	provider: string;
	transactionId: string;
	authUrl: string;
	redirectUri: string;
	expiresAt: string;
};

export type RoutingOAuthCallbackInput = {
	transactionId: string;
	state: string;
	code: string;
};

export type RoutingDeviceCodeChallengeView = {
	provider: string;
	transactionId: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string | null;
	expiresAt: string;
	interval: number | null;
};

export type RoutingOAuthTransactionInput = {
	transactionId: string;
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

/**
 * Shared Task 7 provider-node DTOs mirrored from pinned 9router route handlers.
 * These shapes intentionally exclude credentials from safe views. Create and
 * update payloads model only upstream provider-node configuration fields. The
 * validate DTO includes the temporary apiKey because validation is the only
 * provider-node flow that probes an upstream with user credentials.
 */
export type RoutingProviderNodeType =
	| "openai-compatible"
	| "custom-embedding"
	| "anthropic-compatible";
export type RoutingOpenAiProviderNodeApiType = "chat" | "responses";

export type RoutingProviderNodeView = {
	id: string;
	type: RoutingProviderNodeType;
	name: string;
	prefix: string;
	baseUrl: string;
	apiType: RoutingOpenAiProviderNodeApiType | null;
	createdAt: string | null;
	updatedAt: string | null;
};

export type CreateRoutingProviderNodeInput = {
	name: string;
	prefix: string;
	type: RoutingProviderNodeType;
	apiType?: RoutingOpenAiProviderNodeApiType;
	baseUrl?: string;
};

export type UpdateRoutingProviderNodeInput = {
	name: string;
	prefix: string;
	baseUrl: string;
	apiType?: RoutingOpenAiProviderNodeApiType;
};

export type ValidateRoutingProviderNodeInput = {
	baseUrl: string;
	apiKey: string;
	type: RoutingProviderNodeType;
	modelId?: string;
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

export function emptyRoutingSettingsView(): RoutingSettingsView {
	return {
		runtime: {
			mode: "sidecar",
			status: "unavailable",
			version: null,
			lastCheckedAt: null,
			lastError: null,
			capabilities: { ...EMPTY_CAPABILITIES },
		},
		accountSummary: { total: 0, degraded: 0 },
	};
}
