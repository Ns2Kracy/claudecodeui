import type {
	RoutingClientCredentials,
	RuntimeRoutingConfiguration,
} from "@/shared/types.js";
import { AppError } from "@/shared/utils.js";

import type {
	NineRouterInternalCredentials,
	NineRouterSidecarStatus,
} from "./nine-router-sidecar.service.js";

type RuntimeCredentialsProvider = {
	getStatus(): NineRouterSidecarStatus;
	getInternalCredentials(): NineRouterInternalCredentials;
};

type RoutingRuntimeServiceDependencies = {
	runtime: RuntimeCredentialsProvider;
};

function runtimeUnavailable(): AppError {
	return new AppError("The embedded 9router runtime is unavailable", {
		code: "ROUTING_RUNTIME_UNAVAILABLE",
		statusCode: 409,
	});
}

function safeOperationFailure(): AppError {
	return new AppError(
		"The 9router runtime configuration could not be resolved",
		{ code: "ROUTING_OPERATION_FAILED", statusCode: 502 },
	);
}

function safeRuntimeError(error: unknown): AppError {
	if (error instanceof AppError) {
		return new AppError(
			"The 9router runtime configuration could not be resolved",
			{ code: error.code, statusCode: error.statusCode },
		);
	}
	return safeOperationFailure();
}

/**
 * Used by provider session creation and run dispatch for sticky per-session
 * routing. The provider catalog decides whether this resolver is called, so
 * model IDs remain unchanged and Provider Router stays an internal detail.
 */
export function createRoutingRuntimeService(
	dependencies: RoutingRuntimeServiceDependencies,
) {
	function runtimeCredentials(): RoutingClientCredentials {
		const status = dependencies.runtime.getStatus();
		if (status.state !== "ready") throw runtimeUnavailable();
		const internal = dependencies.runtime.getInternalCredentials();
		return {
			baseUrl: status.origin ?? "http://127.0.0.1:20128",
			adminPassword: internal.initialPassword,
			dataPlaneKey: internal.dataPlaneKey,
		};
	}

	return {
		async resolveForModel(model: string): Promise<RuntimeRoutingConfiguration> {
			const officialModelId = model.trim();
			if (!officialModelId) return { source: "native" };

			try {
				const credentials = runtimeCredentials();
				return {
					source: "9router",
					baseUrl: `${credentials.baseUrl}/api`,
					openAiBaseUrl: `${credentials.baseUrl}/v1`,
					apiKey: credentials.dataPlaneKey,
					routeName: officialModelId,
					model: officialModelId,
				};
			} catch (error) {
				throw safeRuntimeError(error);
			}
		},
	};
}
