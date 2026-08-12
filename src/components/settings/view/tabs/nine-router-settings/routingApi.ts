import {
	type CreateRoutingProviderNodeInput,
	type CreateRoutingApiKeyAccountInput,
	type CreateRoutingRouteInput,
	type RoutingAccountView,
	type RoutingCapabilities,
	type RoutingRuntimeView,
	type RoutingModelView,
	type RoutingDeviceCodeChallengeView,
	type RoutingOAuthCallbackInput,
	type RoutingOAuthPollingStateView,
	type RoutingOAuthStartView,
	type RoutingProviderNodeValidationView,
	type RoutingProviderNodeView,
	type RoutingRouteView,
	type RoutingSettingsView,
	type UpdateRoutingAccountInput,
	type UpdateRoutingRouteInput,
	type ValidateRoutingProviderNodeInput,
} from "../../../../../../shared/routing.js";

type RoutingFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export type RoutingSettingsDetails = {
	accounts?: boolean;
	models?: boolean;
	routes?: boolean;
};

export type RoutingAccountTestResult = {
	healthy: boolean;
	error: string | null;
	refreshed: boolean;
};

type Parser<T> = (value: unknown) => T;

export class RoutingApiError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;

	constructor(
		code: string,
		message: string,
		status: number,
		retryable: boolean,
	) {
		super(message);
		this.name = "RoutingApiError";
		this.code = code;
		this.status = status;
		this.retryable = retryable;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(status = 200): never {
	throw new RoutingApiError(
		"ROUTING_INVALID_RESPONSE",
		"The routing service returned an invalid response.",
		status,
		status >= 500,
	);
}

function requiredString(value: unknown, status?: number): string {
	if (typeof value !== "string") invalidResponse(status);
	return value;
}

function nullableString(value: unknown, status?: number): string | null {
	if (value === null) return null;
	return requiredString(value, status);
}

function requiredBoolean(value: unknown, status?: number): boolean {
	if (typeof value !== "boolean") invalidResponse(status);
	return value;
}

function requiredNumber(value: unknown, status?: number): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		invalidResponse(status);
	return value;
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	status?: number,
): T {
	if (typeof value !== "string" || !allowed.includes(value as T))
		invalidResponse(status);
	return value as T;
}

function record(value: unknown, status?: number): Record<string, unknown> {
	if (!isRecord(value)) invalidResponse(status);
	return value;
}

function array<T>(value: unknown, parser: Parser<T>, status?: number): T[] {
	if (!Array.isArray(value)) invalidResponse(status);
	return value.map((item) => parser(item));
}

function parseCapabilities(
	value: unknown,
	status?: number,
): RoutingCapabilities {
	const item = record(value, status);
	const capabilities = {
		readAccounts: requiredBoolean(item.readAccounts, status),
		writeApiKeyAccounts: requiredBoolean(item.writeApiKeyAccounts, status),
		testAccounts: requiredBoolean(item.testAccounts, status),
		readRoutes: requiredBoolean(item.readRoutes, status),
		writeRoutes: requiredBoolean(item.writeRoutes, status),
		readUsage: requiredBoolean(item.readUsage, status),
		claudeRuntime: requiredBoolean(item.claudeRuntime, status),
		codexRuntime: requiredBoolean(item.codexRuntime, status),
		openCodeRuntime: requiredBoolean(item.openCodeRuntime, status),
		cursorRuntime: requiredBoolean(item.cursorRuntime, status),
	};
	if (capabilities.cursorRuntime !== false) invalidResponse(status);
	return { ...capabilities, cursorRuntime: false };
}

function parseSafeError(
	value: unknown,
	status?: number,
): RoutingRuntimeView["lastError"] {
	if (value === null) return null;
	const item = record(value, status);
	return {
		code: requiredString(item.code, status),
		message: requiredString(item.message, status),
		retryable: requiredBoolean(item.retryable, status),
	};
}

function parseRuntime(value: unknown, status?: number): RoutingRuntimeView {
	const item = record(value, status);
	return {
		mode: oneOf(item.mode, ["sidecar"], status),
		status: oneOf(
			item.status,
			["starting", "ready", "degraded", "unavailable"],
			status,
		),
		version: nullableString(item.version, status),
		lastCheckedAt: nullableString(item.lastCheckedAt, status),
		lastError: parseSafeError(item.lastError, status),
		capabilities: parseCapabilities(item.capabilities, status),
	};
}

function parseAccount(value: unknown, status?: number): RoutingAccountView {
	const item = record(value, status);
	return {
		id: requiredString(item.id, status),
		provider: requiredString(item.provider, status),
		name: requiredString(item.name, status),
		authType: requiredString(item.authType, status),
		priority:
			item.priority === null ? null : requiredNumber(item.priority, status),
		active: requiredBoolean(item.active, status),
		status: oneOf(
			item.status,
			["healthy", "cooling", "limited", "failed", "unknown"],
			status,
		),
		lastError: nullableString(item.lastError, status),
		expiresAt: nullableString(item.expiresAt, status),
	};
}

function parseModel(value: unknown, status?: number): RoutingModelView {
	const item = record(value, status);
	return {
		id: requiredString(item.id, status),
		provider: requiredString(item.provider, status),
		name: requiredString(item.name, status),
	};
}

function parseRoute(value: unknown, status?: number): RoutingRouteView {
	const item = record(value, status);
	return {
		id: requiredString(item.id, status),
		name: requiredString(item.name, status),
		kind: nullableString(item.kind, status),
		models: array(
			item.models,
			(model) => requiredString(model, status),
			status,
		),
	};
}

function parseSettings(value: unknown, status?: number): RoutingSettingsView {
	const item = record(value, status);
	const accountSummary = record(item.accountSummary, status);
	const routeSummary = record(item.routeSummary, status);
	const settings: RoutingSettingsView = {
		runtime: parseRuntime(item.runtime, status),
		accountSummary: {
			total: requiredNumber(accountSummary.total, status),
			degraded: requiredNumber(accountSummary.degraded, status),
		},
		routeSummary: { total: requiredNumber(routeSummary.total, status) },
	};
	if (item.accounts !== undefined) {
		settings.accounts = array(
			item.accounts,
			(account) => parseAccount(account, status),
			status,
		);
	}
	if (item.models !== undefined) {
		settings.models = array(
			item.models,
			(model) => parseModel(model, status),
			status,
		);
	}
	if (item.routes !== undefined) {
		settings.routes = array(
			item.routes,
			(route) => parseRoute(route, status),
			status,
		);
	}
	return settings;
}

function parseAccountTest(
	value: unknown,
	status?: number,
): RoutingAccountTestResult {
	const item = record(value, status);
	return {
		healthy: requiredBoolean(item.healthy, status),
		error: nullableString(item.error, status),
		refreshed: requiredBoolean(item.refreshed, status),
	};
}

function parseOAuthStart(
	value: unknown,
	status?: number,
): RoutingOAuthStartView {
	const item = record(value, status);
	return {
		provider: requiredString(item.provider, status),
		transactionId: requiredString(item.transactionId, status),
		authUrl: requiredString(item.authUrl, status),
		redirectUri: requiredString(item.redirectUri, status),
		expiresAt: requiredString(item.expiresAt, status),
	};
}

function parseDeviceChallenge(
	value: unknown,
	status?: number,
): RoutingDeviceCodeChallengeView {
	const item = record(value, status);
	return {
		provider: requiredString(item.provider, status),
		transactionId: requiredString(item.transactionId, status),
		userCode: requiredString(item.userCode, status),
		verificationUri: requiredString(item.verificationUri, status),
		verificationUriComplete: nullableString(
			item.verificationUriComplete,
			status,
		),
		expiresAt: requiredString(item.expiresAt, status),
		interval:
			item.interval === null ? null : requiredNumber(item.interval, status),
	};
}

function parseOAuthPolling(
	value: unknown,
	status?: number,
): RoutingOAuthPollingStateView {
	const item = record(value, status);
	const pending = requiredBoolean(item.pending, status);
	const account =
		item.account === null ? null : parseAccount(item.account, status);
	if (!pending && account === null) invalidResponse(status);
	return { provider: requiredString(item.provider, status), pending, account };
}

function parseProviderNode(
	value: unknown,
	status?: number,
): RoutingProviderNodeView {
	const item = record(value, status);
	return {
		id: requiredString(item.id, status),
		type: oneOf(
			item.type,
			["openai-compatible", "custom-embedding", "anthropic-compatible"],
			status,
		),
		name: requiredString(item.name, status),
		prefix: requiredString(item.prefix, status),
		baseUrl: requiredString(item.baseUrl, status),
		apiType:
			item.apiType === null
				? null
				: oneOf(item.apiType, ["chat", "responses"] as const, status),
		createdAt: nullableString(item.createdAt, status),
		updatedAt: nullableString(item.updatedAt, status),
	};
}

function parseProviderNodeValidation(
	value: unknown,
	status?: number,
): RoutingProviderNodeValidationView {
	const item = record(value, status);
	return {
		valid: requiredBoolean(item.valid, status),
		message: nullableString(item.message, status),
	};
}

function parseCodexApplication(
	value: unknown,
	status?: number,
): { provider: "Custom" } {
	const item = record(value, status);
	return { provider: oneOf(item.provider, ["Custom"] as const, status) };
}

function parseCancelled(value: unknown, status?: number): { cancelled: true } {
	const item = record(value, status);
	if (item.cancelled !== true) invalidResponse(status);
	return { cancelled: true };
}

function parseDeleted(value: unknown, status?: number): { deleted: true } {
	const item = record(value, status);
	if (item.deleted !== true) invalidResponse(status);
	return { deleted: true };
}

function safeEnvelopeError(
	payload: unknown,
	status: number,
): RoutingApiError | null {
	if (
		!isRecord(payload) ||
		payload.success !== false ||
		!isRecord(payload.error)
	) {
		return null;
	}
	const code =
		typeof payload.error.code === "string" && payload.error.code
			? payload.error.code.slice(0, 100)
			: "ROUTING_REQUEST_FAILED";
	const message =
		typeof payload.error.message === "string" && payload.error.message
			? payload.error.message.slice(0, 500)
			: "The routing request failed.";
	return new RoutingApiError(
		code,
		message,
		status,
		status === 408 || status === 425 || status === 429 || status >= 500,
	);
}

async function parseResponse<T>(
	response: Response,
	parser: Parser<T>,
): Promise<T> {
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		invalidResponse(response.status);
	}

	const envelopeError = safeEnvelopeError(payload, response.status);
	if (envelopeError) throw envelopeError;
	if (!response.ok) {
		throw new RoutingApiError(
			"ROUTING_REQUEST_FAILED",
			"The routing request failed.",
			response.status,
			response.status === 408 ||
				response.status === 425 ||
				response.status === 429 ||
				response.status >= 500,
		);
	}
	if (!isRecord(payload) || payload.success !== true || !("data" in payload)) {
		invalidResponse(response.status);
	}
	return parser(payload.data);
}

function detailQuery(details: RoutingSettingsDetails): string {
	const names: string[] = [];
	if (details.accounts) names.push("accounts");
	if (details.models) names.push("models");
	if (details.routes) names.push("routes");
	if (names.length === 0) return "";
	const query = new URLSearchParams({ details: names.join(",") });
	return `?${query.toString()}`;
}

function jsonRequest(method: string, body?: unknown): RequestInit {
	return {
		method,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	};
}

/** Builds the settings API client; tests inject a fake fetch without exposing request bodies. */
export function createRoutingApiClient(fetcher: RoutingFetch) {
	async function request<T>(
		path: string,
		parser: Parser<T>,
		init?: RequestInit,
	): Promise<T> {
		let response: Response;
		try {
			response = await fetcher(`/api/routing${path}`, init);
		} catch {
			throw new RoutingApiError(
				"ROUTING_NETWORK_ERROR",
				"The routing service could not be reached.",
				0,
				true,
			);
		}
		return parseResponse(response, parser);
	}

	return {
		getSettings(details: RoutingSettingsDetails = {}) {
			return request(detailQuery(details), parseSettings);
		},
		applyToCodex() {
			return request(
				"/codex/applications",
				parseCodexApplication,
				jsonRequest("POST"),
			);
		},
		startOAuth(provider: string) {
			return request(
				`/oauth/${encodeURIComponent(provider)}/authorize`,
				parseOAuthStart,
				jsonRequest("POST"),
			);
		},
		exchangeOAuth(provider: string, input: RoutingOAuthCallbackInput) {
			return request(
				`/oauth/${encodeURIComponent(provider)}/callback`,
				parseAccount,
				jsonRequest("POST", input),
			);
		},
		startDeviceCode(provider: string) {
			return request(
				`/oauth/${encodeURIComponent(provider)}/device-code`,
				parseDeviceChallenge,
				jsonRequest("POST"),
			);
		},
		pollDeviceCode(provider: string, transactionId: string) {
			return request(
				`/oauth/${encodeURIComponent(provider)}/poll`,
				parseOAuthPolling,
				jsonRequest("POST", { transactionId }),
			);
		},
		cancelDeviceCode(provider: string, transactionId: string) {
			return request(
				`/oauth/${encodeURIComponent(provider)}/cancel`,
				parseCancelled,
				jsonRequest("POST", { transactionId }),
			);
		},
		listProviderNodes() {
			return request("/provider-nodes", (value) =>
				array(value, parseProviderNode),
			);
		},
		createProviderNode(input: CreateRoutingProviderNodeInput) {
			return request(
				"/provider-nodes",
				parseProviderNode,
				jsonRequest("POST", input),
			);
		},
		validateProviderNode(input: ValidateRoutingProviderNodeInput) {
			return request(
				"/provider-nodes/validations",
				parseProviderNodeValidation,
				jsonRequest("POST", input),
			);
		},
		createAccount(input: CreateRoutingApiKeyAccountInput) {
			return request("/accounts", parseAccount, jsonRequest("POST", input));
		},
		updateAccount(id: string, input: UpdateRoutingAccountInput) {
			return request(
				`/accounts/${encodeURIComponent(id)}`,
				parseAccount,
				jsonRequest("PUT", input),
			);
		},
		testAccount(id: string) {
			return request(
				`/accounts/${encodeURIComponent(id)}/tests`,
				parseAccountTest,
				jsonRequest("POST"),
			);
		},
		deleteAccount(id: string) {
			return request(
				`/accounts/${encodeURIComponent(id)}`,
				parseDeleted,
				jsonRequest("DELETE"),
			);
		},
		createRoute(input: CreateRoutingRouteInput) {
			return request("/routes", parseRoute, jsonRequest("POST", input));
		},
		updateRoute(id: string, input: UpdateRoutingRouteInput) {
			return request(
				`/routes/${encodeURIComponent(id)}`,
				parseRoute,
				jsonRequest("PUT", input),
			);
		},
		deleteRoute(id: string) {
			return request(
				`/routes/${encodeURIComponent(id)}`,
				parseDeleted,
				jsonRequest("DELETE"),
			);
		},
	};
}

const authenticatedRoutingFetch: RoutingFetch = async (input, init) => {
	const { authenticatedFetch } = await import("../../../../../utils/api.js");
	return authenticatedFetch(input, init) as Promise<Response>;
};

export const routingApi = createRoutingApiClient(authenticatedRoutingFetch);
