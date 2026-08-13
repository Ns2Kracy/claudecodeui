import type {
	IRoutingNineRouterClient,
	RoutingNineRouterDeviceCodeInternalResult,
	RoutingNineRouterOAuthExchangeInternalInput,
	RoutingNineRouterOAuthPollInternalInput,
	RoutingNineRouterOAuthStartInternalResult,
} from "@/shared/interfaces.js";
import { AppError } from "@/shared/utils.js";

import type {
	CreateRoutingApiKeyAccountInput,
	CreateRoutingProviderNodeInput,
	RoutingAccountView,
	RoutingCapabilities,
	RoutingModelView,
	RoutingOAuthPollingStateView,
	RoutingProviderModelsView,
	RoutingProviderNodeValidationView,
	RoutingProviderNodeView,
	RoutingProviderNodeType,
	UpdateRoutingAccountInput,
	UpdateRoutingProviderNodeInput,
	ValidateRoutingProviderNodeInput,
} from "../../../shared/routing.js";

import { getNineRouterCapabilityProfile } from "./nine-router-capabilities.js";
import { requestNineRouterJson } from "./nine-router-http.js";

type NineRouterHttpInput = Parameters<typeof requestNineRouterJson>[0];
type NineRouterHttpResult = Awaited<ReturnType<typeof requestNineRouterJson>>;
type CapabilityProfile = NonNullable<
	ReturnType<typeof getNineRouterCapabilityProfile>
>;
type CapabilityName = keyof RoutingCapabilities;

type NineRouterClientDependencies = {
	baseUrl: string;
	adminPassword: string;
	dataPlaneKey: string;
	request: typeof requestNineRouterJson;
	now?: () => Date;
};

type NineRouterValidationResult = {
	version: string;
	knownVersion: boolean;
	capabilities: RoutingCapabilities;
};

type AccountTestResult = {
	healthy: boolean;
	error: string | null;
	refreshed: boolean;
};

const COOKIE_TTL_MS = 20 * 60 * 60 * 1000;
const MAX_UPSTREAM_STRING_LENGTH = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(): AppError {
	return new AppError("9router returned an invalid response", {
		code: "ROUTING_UPSTREAM_RESPONSE_INVALID",
		statusCode: 502,
	});
}

function authFailed(): AppError {
	return new AppError("9router management authentication failed", {
		code: "ROUTING_AUTH_FAILED",
		statusCode: 401,
	});
}

function apiKeyRejected(): AppError {
	return new AppError("9router rejected the configured data-plane key", {
		code: "ROUTING_API_KEY_REJECTED",
		statusCode: 401,
	});
}

function capabilityUnavailable(): AppError {
	return new AppError(
		"This operation is unavailable for the detected 9router version",
		{
			code: "ROUTING_CAPABILITY_UNAVAILABLE",
			statusCode: 409,
		},
	);
}

function resourceNotFound(): AppError {
	return new AppError("The requested 9router resource was not found", {
		code: "ROUTING_RESOURCE_NOT_FOUND",
		statusCode: 404,
	});
}

function operationFailed(): AppError {
	return new AppError("The 9router operation failed", {
		code: "ROUTING_OPERATION_FAILED",
		statusCode: 502,
	});
}

function requiredString(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > MAX_UPSTREAM_STRING_LENGTH
	) {
		throw invalidResponse();
	}
	return value;
}

function optionalString(value: unknown): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	return requiredString(value);
}

function nullableNumber(value: unknown): number | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (!Number.isFinite(value)) {
		throw invalidResponse();
	}
	return value as number;
}

function optionalProviderNodeType(value: unknown): RoutingProviderNodeType {
	if (
		value !== "openai-compatible" &&
		value !== "custom-embedding" &&
		value !== "anthropic-compatible"
	)
		throw invalidResponse();
	return value;
}

function optionalApiType(value: unknown): "chat" | "responses" | null {
	if (value === undefined || value === null || value === "") return null;
	if (value !== "chat" && value !== "responses") throw invalidResponse();
	return value;
}

function expectRecord(data: unknown): Record<string, unknown> {
	if (!isRecord(data)) {
		throw invalidResponse();
	}
	return data;
}

function assertSuccessStatus(result: NineRouterHttpResult): void {
	if (result.statusCode >= 200 && result.statusCode < 300) {
		return;
	}
	if (result.statusCode === 401 || result.statusCode === 403) {
		throw authFailed();
	}
	if (result.statusCode === 404) {
		throw resourceNotFound();
	}
	throw operationFailed();
}

function sanitizeAccount(value: unknown, now: Date): RoutingAccountView {
	if (!isRecord(value) || typeof value.isActive !== "boolean") {
		throw invalidResponse();
	}
	const id = requiredString(value.id);
	const provider = requiredString(value.provider);
	const name =
		optionalString(value.name) ?? optionalString(value.email) ?? provider;
	const authType = requiredString(value.authType);
	const priority = nullableNumber(value.priority);
	const expiresAt = optionalString(value.expiresAt);
	const testStatus =
		typeof value.testStatus === "string" ? value.testStatus.toLowerCase() : "";
	const errorCode =
		typeof value.errorCode === "string" ? value.errorCode.toLowerCase() : "";
	const rateLimitedUntil = Date.parse(
		typeof value.rateLimitedUntil === "string" ? value.rateLimitedUntil : "",
	);

	let status: RoutingAccountView["status"] = "unknown";
	if (Number.isFinite(rateLimitedUntil) && rateLimitedUntil > now.getTime()) {
		status = "cooling";
	} else if (
		["limited", "rate_limited", "quota_exceeded"].includes(testStatus) ||
		errorCode.includes("rate")
	) {
		status = "limited";
	} else if (
		["active", "success", "valid", "healthy", "passed"].includes(testStatus)
	) {
		status = "healthy";
	} else if (
		["error", "failed", "invalid"].includes(testStatus) ||
		(typeof value.lastError === "string" && value.lastError.length > 0)
	) {
		status = "failed";
	}

	return {
		id,
		provider,
		name,
		authType,
		priority,
		active: value.isActive,
		status,
		lastError:
			typeof value.lastError === "string" && value.lastError
				? "The upstream account reported an error"
				: null,
		expiresAt,
	};
}

function sanitizeModel(
	value: unknown,
	envelopeProvider: string,
): RoutingModelView {
	if (!isRecord(value)) {
		throw invalidResponse();
	}
	const provider = optionalString(value.provider) ?? envelopeProvider;
	const model = optionalString(value.model);
	const id =
		optionalString(value.fullModel) ??
		optionalString(value.routedModel) ??
		optionalString(value.id);
	if (!id) throw invalidResponse();
	const name =
		optionalString(value.name) ?? optionalString(value.alias) ?? model ?? id;
	return { id, provider, name };
}

function sanitizeProviderModels(value: unknown): RoutingProviderModelsView {
	const data = expectRecord(value);
	const provider = requiredString(data.provider);
	const models = data.models;
	if (!Array.isArray(models)) throw invalidResponse();
	return {
		provider,
		connectionId: requiredString(data.connectionId),
		models: models.map((model) => sanitizeModel(model, provider)),
	};
}

function sanitizeOAuthStart(
	provider: string,
	value: unknown,
): RoutingNineRouterOAuthStartInternalResult {
	const data = expectRecord(value);
	return {
		provider,
		authUrl: requiredString(data.authUrl),
		state: requiredString(data.state),
		redirectUri: requiredString(data.redirectUri),
		codeVerifier: requiredString(data.codeVerifier),
	};
}

function sanitizeDeviceCode(
	provider: string,
	value: unknown,
): RoutingNineRouterDeviceCodeInternalResult {
	const data = expectRecord(value);
	let extraData: unknown = null;
	if (data.extraData !== undefined && data.extraData !== null) {
		try {
			extraData = JSON.parse(JSON.stringify(data.extraData)) as unknown;
		} catch {
			throw invalidResponse();
		}
	}
	return {
		provider,
		deviceCode: requiredString(data.device_code),
		codeVerifier: requiredString(data.codeVerifier),
		extraData,
		userCode: requiredString(data.user_code),
		verificationUri: requiredString(data.verification_uri),
		verificationUriComplete: optionalString(data.verification_uri_complete),
		expiresIn: nullableNumber(data.expires_in),
		interval: nullableNumber(data.interval),
	};
}

function sanitizePoll(
	provider: string,
	value: unknown,
	now: Date,
): RoutingOAuthPollingStateView {
	const data = expectRecord(value);
	if (typeof data.pending !== "boolean") throw invalidResponse();
	const account =
		data.connection === undefined || data.connection === null
			? null
			: sanitizeAccount(data.connection, now);
	return { provider, pending: data.pending, account };
}

function sanitizeProviderNode(value: unknown): RoutingProviderNodeView {
	const data = expectRecord(value);
	return {
		id: requiredString(data.id),
		type: optionalProviderNodeType(data.type),
		name: requiredString(data.name),
		prefix: requiredString(data.prefix),
		baseUrl: requiredString(data.baseUrl),
		apiType: optionalApiType(data.apiType),
		createdAt: optionalString(data.createdAt),
		updatedAt: optionalString(data.updatedAt),
	};
}

function sanitizeNodePayload(
	input:
		| CreateRoutingProviderNodeInput
		| UpdateRoutingProviderNodeInput
		| ValidateRoutingProviderNodeInput,
): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if ("name" in input && input.name !== undefined) payload.name = input.name;
	if ("prefix" in input && input.prefix !== undefined)
		payload.prefix = input.prefix;
	if ("type" in input && input.type !== undefined) payload.type = input.type;
	if ("baseUrl" in input && input.baseUrl !== undefined)
		payload.baseUrl = input.baseUrl;
	if ("apiType" in input && input.apiType !== undefined)
		payload.apiType = input.apiType;
	if ("apiKey" in input && input.apiKey !== undefined)
		payload.apiKey = input.apiKey;
	if ("modelId" in input && input.modelId !== undefined)
		payload.modelId = input.modelId;
	return payload;
}

function sanitizedAccountPayload(
	input: CreateRoutingApiKeyAccountInput,
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		provider: input.provider,
		name: input.name,
		apiKey: input.apiKey,
	};
	if (input.priority !== undefined) payload.priority = input.priority;
	return payload;
}

function sanitizedAccountUpdate(
	input: UpdateRoutingAccountInput,
): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (input.name !== undefined) payload.name = input.name;
	if (input.apiKey !== undefined) payload.apiKey = input.apiKey;
	if (input.priority !== undefined) payload.priority = input.priority;
	if (input.active !== undefined) payload.isActive = input.active;
	return payload;
}

/**
 * Used by routing services as the sole typed adapter for the inspected 9router
 * management and data-plane APIs. It owns in-memory dashboard cookies, version
 * gates, response validation, safe DTO mapping, and GET-only auth refresh.
 */
export class NineRouterClient implements IRoutingNineRouterClient {
	private readonly baseUrl: string;
	private readonly adminPassword: string;
	private readonly dataPlaneKey: string;
	private readonly request: typeof requestNineRouterJson;
	private readonly now: () => Date;
	private profile: CapabilityProfile | null = null;
	private cookie: string | null = null;
	private cookieExpiresAt = 0;
	private authenticationNotRequired = false;

	constructor(dependencies: NineRouterClientDependencies) {
		this.baseUrl = dependencies.baseUrl;
		this.adminPassword = dependencies.adminPassword;
		this.dataPlaneKey = dependencies.dataPlaneKey;
		this.request = dependencies.request;
		this.now = dependencies.now ?? (() => new Date());
	}

	async validateConnection(): Promise<NineRouterValidationResult> {
		const health = await this.request({
			baseUrl: this.baseUrl,
			operation: "health",
		});
		assertSuccessStatus(health);
		if (expectRecord(health.data).ok !== true) {
			throw invalidResponse();
		}

		const profile = await this.loadProfile(true);
		await this.ensureAuthenticated(true);
		await this.validateDataPlaneKey();
		return {
			version: profile.version,
			knownVersion: profile.knownVersion,
			capabilities: { ...profile.capabilities },
		};
	}

	async listModels(
		accountSnapshot?: RoutingAccountView[],
	): Promise<RoutingModelView[]> {
		const accounts = (accountSnapshot ?? (await this.listAccounts())).filter(
			(account) => account.active,
		);
		const results = await Promise.all(
			accounts.map(
				async (account) => (await this.listProviderModels(account.id)).models,
			),
		);
		const models = new Map<string, RoutingModelView>();
		for (const model of results.flat()) {
			if (!models.has(model.id)) models.set(model.id, model);
		}
		return [...models.values()];
	}

	async listAccounts(): Promise<RoutingAccountView[]> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "accountsList" },
			"readAccounts",
			true,
		);
		const connections = expectRecord(result.data).connections;
		if (!Array.isArray(connections)) {
			throw invalidResponse();
		}
		const now = this.now();
		return connections.map((connection) => sanitizeAccount(connection, now));
	}

	async getProvider(id: string): Promise<RoutingAccountView> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "providerGet", id },
			"readAccounts",
			true,
		);
		return sanitizeAccount(expectRecord(result.data).connection, this.now());
	}

	async listProviderModels(id: string): Promise<RoutingProviderModelsView> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "providerModels", id },
			"readAccounts",
			true,
		);
		return sanitizeProviderModels(result.data);
	}

	async startOAuth(
		provider: string,
		redirectUri: string,
	): Promise<RoutingNineRouterOAuthStartInternalResult> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "oauthAuthorize",
				provider,
				redirectUri,
			},
			"writeApiKeyAccounts",
			true,
		);
		return sanitizeOAuthStart(provider, result.data);
	}

	async exchangeOAuth(
		provider: string,
		input: RoutingNineRouterOAuthExchangeInternalInput,
	): Promise<RoutingAccountView> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "oauthExchange",
				provider,
				body: input,
			},
			"writeApiKeyAccounts",
			false,
		);
		return sanitizeAccount(
			expectRecord(result.data).connection ?? result.data,
			this.now(),
		);
	}

	async startDeviceCode(
		provider: string,
	): Promise<RoutingNineRouterDeviceCodeInternalResult> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "oauthDeviceCode", provider },
			"writeApiKeyAccounts",
			true,
		);
		return sanitizeDeviceCode(provider, result.data);
	}

	async pollDeviceCode(
		provider: string,
		input: RoutingNineRouterOAuthPollInternalInput,
	): Promise<RoutingOAuthPollingStateView> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "oauthPoll", provider, body: input },
			"writeApiKeyAccounts",
			false,
		);
		return sanitizePoll(provider, result.data, this.now());
	}

	async listProviderNodes(): Promise<RoutingProviderNodeView[]> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "providerNodesList" },
			"readAccounts",
			true,
		);
		const nodes =
			expectRecord(result.data).nodes ??
			expectRecord(result.data).providerNodes;
		if (!Array.isArray(nodes)) throw invalidResponse();
		return nodes.map(sanitizeProviderNode);
	}

	async createProviderNode(
		input: CreateRoutingProviderNodeInput,
	): Promise<RoutingProviderNodeView> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "providerNodeCreate",
				body: sanitizeNodePayload(input),
			},
			"writeApiKeyAccounts",
			false,
		);
		return sanitizeProviderNode(
			expectRecord(result.data).node ?? expectRecord(result.data),
		);
	}

	async validateProviderNode(
		input: ValidateRoutingProviderNodeInput,
	): Promise<RoutingProviderNodeValidationView> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "providerNodeValidate",
				body: sanitizeNodePayload(input),
			},
			"testAccounts",
			false,
		);
		const data = expectRecord(result.data);
		if (typeof data.valid !== "boolean") throw invalidResponse();
		return {
			valid: data.valid,
			message: data.valid
				? null
				: "The upstream provider node validation failed",
		};
	}

	async updateProviderNode(
		id: string,
		input: UpdateRoutingProviderNodeInput,
	): Promise<RoutingProviderNodeView> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "providerNodeUpdate",
				id,
				body: sanitizeNodePayload(input),
			},
			"writeApiKeyAccounts",
			false,
		);
		return sanitizeProviderNode(
			expectRecord(result.data).node ?? expectRecord(result.data),
		);
	}

	async deleteProviderNode(id: string): Promise<void> {
		await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "providerNodeDelete", id },
			"writeApiKeyAccounts",
			false,
		);
	}

	async createApiKeyAccount(
		input: CreateRoutingApiKeyAccountInput,
	): Promise<RoutingAccountView> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "accountCreate",
				body: sanitizedAccountPayload(input),
			},
			"writeApiKeyAccounts",
			false,
		);
		return sanitizeAccount(expectRecord(result.data).connection, this.now());
	}

	async updateAccount(
		id: string,
		input: UpdateRoutingAccountInput,
	): Promise<RoutingAccountView> {
		const result = await this.managementRequest(
			{
				baseUrl: this.baseUrl,
				operation: "accountUpdate",
				id,
				body: sanitizedAccountUpdate(input),
			},
			"writeApiKeyAccounts",
			false,
		);
		return sanitizeAccount(expectRecord(result.data).connection, this.now());
	}

	async deleteAccount(id: string): Promise<void> {
		await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "accountDelete", id },
			"writeApiKeyAccounts",
			false,
		);
	}

	async testAccount(id: string): Promise<AccountTestResult> {
		const result = await this.managementRequest(
			{ baseUrl: this.baseUrl, operation: "accountTest", id },
			"testAccounts",
			false,
		);
		const data = expectRecord(result.data);
		if (typeof data.valid !== "boolean") {
			throw invalidResponse();
		}
		return {
			healthy: data.valid,
			error:
				data.valid || data.error === null || data.error === undefined
					? null
					: "The upstream account test failed",
			refreshed: data.refreshed === true,
		};
	}

	private async loadProfile(refresh = false): Promise<CapabilityProfile> {
		if (this.profile && !refresh) {
			return this.profile;
		}
		const result = await this.request({
			baseUrl: this.baseUrl,
			operation: "version",
		});
		assertSuccessStatus(result);
		const version = expectRecord(result.data).currentVersion;
		if (typeof version !== "string") {
			throw invalidResponse();
		}
		const profile = getNineRouterCapabilityProfile(version);
		if (!profile) {
			throw invalidResponse();
		}
		this.profile = profile;
		return profile;
	}

	private async ensureAuthenticated(force = false): Promise<void> {
		if (
			!force &&
			(this.authenticationNotRequired ||
				(this.cookie !== null && this.cookieExpiresAt > this.now().getTime()))
		) {
			return;
		}

		this.invalidateAuthentication();
		const statusResult = await this.request({
			baseUrl: this.baseUrl,
			operation: "authStatus",
		});
		assertSuccessStatus(statusResult);
		const status = expectRecord(statusResult.data);
		if (
			typeof status.requireLogin !== "boolean" ||
			typeof status.authMode !== "string"
		) {
			throw invalidResponse();
		}
		if (!status.requireLogin) {
			this.authenticationNotRequired = true;
			return;
		}
		if (status.authMode !== "password") {
			throw authFailed();
		}

		const loginResult = await this.request({
			baseUrl: this.baseUrl,
			operation: "login",
			body: { password: this.adminPassword },
		});
		if (
			loginResult.statusCode === 401 ||
			loginResult.statusCode === 403 ||
			loginResult.statusCode === 429
		) {
			throw authFailed();
		}
		assertSuccessStatus(loginResult);
		if (expectRecord(loginResult.data).success !== true) {
			throw authFailed();
		}
		const cookie = this.readAuthCookie(loginResult.headers["set-cookie"]);
		if (!cookie) {
			throw invalidResponse();
		}
		this.cookie = cookie;
		this.cookieExpiresAt = this.now().getTime() + COOKIE_TTL_MS;
	}

	private readAuthCookie(setCookie: string[] | undefined): string | null {
		for (const item of setCookie ?? []) {
			const pair = item.split(";", 1)[0]?.trim();
			if (
				pair?.startsWith("auth_token=") &&
				pair.length > "auth_token=".length
			) {
				return pair;
			}
		}
		return null;
	}

	private invalidateAuthentication(): void {
		this.cookie = null;
		this.cookieExpiresAt = 0;
		this.authenticationNotRequired = false;
	}

	private async validateDataPlaneKey(): Promise<void> {
		const result = await this.request({
			baseUrl: this.baseUrl,
			operation: "dataPlaneModels",
			authorization: `Bearer ${this.dataPlaneKey}`,
		});
		if (result.statusCode === 401 || result.statusCode === 403) {
			throw apiKeyRejected();
		}
		assertSuccessStatus(result);
		const models = expectRecord(result.data).data;
		if (!Array.isArray(models)) {
			throw invalidResponse();
		}
		for (const model of models) {
			if (!isRecord(model) || typeof model.id !== "string") {
				throw invalidResponse();
			}
		}
	}

	private async managementRequest(
		input: NineRouterHttpInput,
		capability: CapabilityName | null,
		retryGetAfterAuth: boolean,
	): Promise<NineRouterHttpResult> {
		const profile = await this.loadProfile();
		if (capability && profile.capabilities[capability] !== true) {
			throw capabilityUnavailable();
		}
		await this.ensureAuthenticated();

		const send = () =>
			this.request({
				...input,
				cookie: this.cookie ?? undefined,
			});
		let result = await send();
		if (result.statusCode === 401) {
			this.invalidateAuthentication();
			if (!retryGetAfterAuth) {
				throw authFailed();
			}
			await this.ensureAuthenticated(true);
			result = await send();
		}
		assertSuccessStatus(result);
		return result;
	}
}
