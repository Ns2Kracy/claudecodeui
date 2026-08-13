import express, { type Request } from "express";

import {
	AppError,
	asyncHandler,
	createApiSuccessResponse,
} from "@/shared/utils.js";

import type {
	CreateRoutingApiKeyAccountInput,
	CreateRoutingProviderNodeInput,
	RoutingProviderNodeType,
	UpdateRoutingAccountInput,
	UpdateRoutingProviderNodeInput,
	ValidateRoutingProviderNodeInput,
} from "../../../shared/routing.js";

import {
	createRoutingMutationGuard,
	createRoutingRateLimiter,
} from "./routing-request-guard.js";
import type { createRoutingService } from "./routing.service.js";

type AuthenticatedRequest = Request & { user?: { id?: number | string } };
type JsonRecord = Record<string, unknown>;

function invalidRequest(message = "Invalid routing request"): AppError {
	return new AppError(message, {
		code: "ROUTING_INVALID_REQUEST",
		statusCode: 400,
	});
}

function userId(request: Request): number {
	const value = Number((request as AuthenticatedRequest).user?.id);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new AppError("An authenticated user is required", {
			code: "AUTHENTICATED_USER_REQUIRED",
			statusCode: 401,
		});
	}
	return value;
}

function bodyRecord(request: Request): JsonRecord {
	if (
		!request.body ||
		typeof request.body !== "object" ||
		Array.isArray(request.body)
	) {
		throw invalidRequest();
	}
	return request.body as JsonRecord;
}

function requiredString(
	value: unknown,
	fieldName: string,
	maximumLength = 1024,
): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > maximumLength
	) {
		throw invalidRequest(`${fieldName} is required`);
	}
	return value;
}

function optionalString(
	value: unknown,
	fieldName: string,
	maximumLength = 16_384,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length > maximumLength) {
		throw invalidRequest(`${fieldName} must be a string`);
	}
	return value;
}

function optionalNonEmptyString(
	value: unknown,
	fieldName: string,
	maximumLength = 1024,
): string | undefined {
	const result = optionalString(value, fieldName, maximumLength);
	if (result !== undefined && !result.trim()) {
		throw invalidRequest(`${fieldName} must not be empty`);
	}
	return result;
}

function optionalNullableString(
	value: unknown,
	fieldName: string,
	maximumLength = 1024,
): string | null | undefined {
	if (value === null) return null;
	return optionalString(value, fieldName, maximumLength);
}

function optionalBoolean(
	value: unknown,
	fieldName: string,
): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		throw invalidRequest(`${fieldName} must be a boolean`);
	}
	return value;
}

function optionalInteger(
	value: unknown,
	fieldName: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw invalidRequest(`${fieldName} must be a non-negative integer`);
	}
	return Number(value);
}

function accountCreateInput(request: Request): CreateRoutingApiKeyAccountInput {
	const body = bodyRecord(request);
	const input: CreateRoutingApiKeyAccountInput = {
		provider: requiredString(body.provider, "provider", 256),
		name: requiredString(body.name, "name", 256),
		apiKey: requiredString(body.apiKey, "apiKey", 16_384),
	};
	const priority = optionalInteger(body.priority, "priority");
	const active = optionalBoolean(body.active, "active");
	if (priority !== undefined) input.priority = priority;
	if (active !== undefined) input.active = active;
	return input;
}

function accountUpdateInput(request: Request): UpdateRoutingAccountInput {
	const body = bodyRecord(request);
	const input: UpdateRoutingAccountInput = {};
	const name = optionalNonEmptyString(body.name, "name", 256);
	const apiKey = optionalNonEmptyString(body.apiKey, "apiKey", 16_384);
	const priority = optionalInteger(body.priority, "priority");
	const active = optionalBoolean(body.active, "active");
	if (name !== undefined) input.name = name;
	if (apiKey !== undefined) input.apiKey = apiKey;
	if (priority !== undefined) input.priority = priority;
	if (active !== undefined) input.active = active;
	if (Object.keys(input).length === 0) throw invalidRequest();
	return input;
}

function providerNodeType(value: unknown): RoutingProviderNodeType {
	if (
		value !== "openai-compatible" &&
		value !== "custom-embedding" &&
		value !== "anthropic-compatible"
	) {
		throw invalidRequest("type is invalid");
	}
	return value;
}

function providerNodeApiType(value: unknown): "chat" | "responses" | undefined {
	if (value === undefined) return undefined;
	if (value !== "chat" && value !== "responses")
		throw invalidRequest("apiType is invalid");
	return value;
}

function providerNodeBaseUrl(
	value: unknown,
	required: boolean,
): string | undefined {
	if (value === undefined && !required) return undefined;
	const baseUrl = requiredString(value, "baseUrl", 2048).trim();
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw invalidRequest("baseUrl is invalid");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw invalidRequest("baseUrl is invalid");
	if (url.username || url.password || url.hash)
		throw invalidRequest("baseUrl is invalid");
	// This CloudCLI boundary only enforces URL syntax for provider-node DTOs.
	// The pinned upstream /api/provider-nodes/validate handler performs DNS and
	// private-target SSRF enforcement before its only provider-node network probe.
	return baseUrl;
}

function assertProviderNodeApiType(
	type: RoutingProviderNodeType,
	apiType: "chat" | "responses" | undefined,
): void {
	if (type === "openai-compatible" && apiType === undefined)
		throw invalidRequest("apiType is required");
}

function providerNodeCreateInput(
	request: Request,
): CreateRoutingProviderNodeInput {
	const body = bodyRecord(request);
	const type = providerNodeType(body.type);
	const apiType = providerNodeApiType(body.apiType);
	assertProviderNodeApiType(type, apiType);
	const input: CreateRoutingProviderNodeInput = {
		name: requiredString(body.name, "name", 256),
		prefix: requiredString(body.prefix, "prefix", 256),
		type,
	};
	const baseUrl = providerNodeBaseUrl(body.baseUrl, false);
	if (apiType !== undefined) input.apiType = apiType;
	if (baseUrl !== undefined) input.baseUrl = baseUrl;
	return input;
}

function providerNodeUpdateInput(
	request: Request,
): UpdateRoutingProviderNodeInput {
	const body = bodyRecord(request);
	const apiType = providerNodeApiType(body.apiType);
	const input: UpdateRoutingProviderNodeInput = {
		name: requiredString(body.name, "name", 256),
		prefix: requiredString(body.prefix, "prefix", 256),
		baseUrl: providerNodeBaseUrl(body.baseUrl, true) as string,
	};
	if (apiType !== undefined) input.apiType = apiType;
	return input;
}

function providerNodeValidateInput(
	request: Request,
): ValidateRoutingProviderNodeInput {
	const body = bodyRecord(request);
	const type = providerNodeType(body.type);
	const input: ValidateRoutingProviderNodeInput = {
		baseUrl: providerNodeBaseUrl(body.baseUrl, true) as string,
		apiKey: requiredString(body.apiKey, "apiKey", 16_384),
		type,
	};
	const modelId = optionalNonEmptyString(body.modelId, "modelId", 1024);
	if (type === "custom-embedding" && modelId === undefined)
		throw invalidRequest("modelId is required");
	if (modelId !== undefined) input.modelId = modelId;
	return input;
}

function oauthProviderParam(request: Request): string {
	const provider = requiredString(request.params.provider, "provider", 64);
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider))
		throw invalidRequest("provider is invalid");
	return provider;
}

function resourceId(request: Request): string {
	return requiredString(request.params.id, "id", 512);
}

function oauthTransactionInput(request: Request): { transactionId: string } {
	const body = bodyRecord(request);
	return {
		transactionId: requiredString(body.transactionId, "transactionId", 512),
	};
}

function oauthCallbackInput(request: Request): {
	transactionId: string;
	state: string;
	code: string;
} {
	const transactionId =
		typeof request.query.transactionId === "string"
			? request.query.transactionId
			: bodyRecord(request).transactionId;
	const state =
		typeof request.query.state === "string"
			? request.query.state
			: bodyRecord(request).state;
	const code =
		typeof request.query.code === "string"
			? request.query.code
			: bodyRecord(request).code;
	return {
		transactionId: requiredString(transactionId, "transactionId", 512),
		state: requiredString(state, "state", 512),
		code: requiredString(code, "code", 4096),
	};
}

function settingsDetails(request: Request) {
	const raw =
		typeof request.query.details === "string" ? request.query.details : "";
	const details: {
		accounts?: boolean;
		models?: boolean;
		routes?: boolean;
	} = {};
	const allowed = new Set(["accounts", "models", "routes"]);
	for (const item of raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)) {
		if (!allowed.has(item)) throw invalidRequest("details is invalid");
		details[item as "accounts" | "models" | "routes"] = true;
	}
	return details;
}

/** Creates the authenticated, same-origin, allowlisted routing HTTP API. */
export function createRoutingRouter(
	service: ReturnType<typeof createRoutingService>,
): express.Router {
	const router = express.Router();
	const mutationGuard = createRoutingMutationGuard();
	const writeLimiter = createRoutingRateLimiter({
		limit: 30,
		windowMs: 60_000,
	});
	const writeGuards = [mutationGuard, writeLimiter];

	router.get(
		"/",
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.getSettings(userId(request), settingsDetails(request)),
				),
			);
		}),
	);
	router.post(
		"/oauth/:provider/authorize",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.startOAuth(
						userId(request),
						oauthProviderParam(request),
					),
				),
			);
		}),
	);
	router.post(
		"/oauth/:provider/callback",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.exchangeOAuth(
						userId(request),
						oauthProviderParam(request),
						oauthCallbackInput(request),
					),
				),
			);
		}),
	);
	router.post(
		"/oauth/:provider/device-code",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.startDeviceCode(
						userId(request),
						oauthProviderParam(request),
					),
				),
			);
		}),
	);
	router.post(
		"/oauth/:provider/poll",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.pollDeviceCode(
						userId(request),
						oauthProviderParam(request),
						oauthTransactionInput(request),
					),
				),
			);
		}),
	);
	router.post(
		"/oauth/:provider/cancel",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.cancelDeviceCode(
						userId(request),
						oauthProviderParam(request),
						oauthTransactionInput(request),
					),
				),
			);
		}),
	);

	router.get(
		"/accounts/:id",
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.getProvider(userId(request), resourceId(request)),
				),
			);
		}),
	);
	router.get(
		"/accounts/:id/models",
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.listProviderModels(
						userId(request),
						resourceId(request),
					),
				),
			);
		}),
	);
	router.get(
		"/provider-nodes",
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.listProviderNodes(userId(request)),
				),
			);
		}),
	);
	router.post(
		"/provider-nodes",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.createProviderNode(
						userId(request),
						providerNodeCreateInput(request),
					),
				),
			);
		}),
	);
	router.post(
		"/provider-nodes/validations",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.validateProviderNode(
						userId(request),
						providerNodeValidateInput(request),
					),
				),
			);
		}),
	);
	router.put(
		"/provider-nodes/:id",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.updateProviderNode(
						userId(request),
						resourceId(request),
						providerNodeUpdateInput(request),
					),
				),
			);
		}),
	);
	router.delete(
		"/provider-nodes/:id",
		...writeGuards,
		asyncHandler(async (request, response) => {
			await service.deleteProviderNode(userId(request), resourceId(request));
			response.json(createApiSuccessResponse({ deleted: true }));
		}),
	);
	router.post(
		"/accounts",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.createApiKeyAccount(
						userId(request),
						accountCreateInput(request),
					),
				),
			);
		}),
	);
	router.put(
		"/accounts/:id",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.updateAccount(
						userId(request),
						resourceId(request),
						accountUpdateInput(request),
					),
				),
			);
		}),
	);
	router.post(
		"/accounts/:id/tests",
		...writeGuards,
		asyncHandler(async (request, response) => {
			response.json(
				createApiSuccessResponse(
					await service.testAccount(userId(request), resourceId(request)),
				),
			);
		}),
	);
	router.delete(
		"/accounts/:id",
		...writeGuards,
		asyncHandler(async (request, response) => {
			await service.deleteAccount(userId(request), resourceId(request));
			response.json(createApiSuccessResponse({ deleted: true }));
		}),
	);
	return router;
}
