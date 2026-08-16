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
	ensureDataPlaneKey?(): Promise<boolean>;
};

type RoutingRuntimeServiceDependencies = {
	runtime: RuntimeCredentialsProvider;
};

function safeOperationFailure(): AppError {
	return new AppError("The Router configuration could not be resolved", {
		code: "ROUTING_OPERATION_FAILED",
		statusCode: 502,
	});
}

function safeRuntimeError(error: unknown): AppError {
	if (error instanceof AppError) {
		return new AppError("The Router configuration could not be resolved", {
			code: error.code,
			statusCode: error.statusCode,
		});
	}
	return safeOperationFailure();
}

/**
 * Used by provider session creation and run dispatch for sticky per-session
 * routing. The selected model ID is passed through unchanged; Router remains
 * an internal transport detail and never substitutes another model.
 */
export function createRoutingRuntimeService(
	dependencies: RoutingRuntimeServiceDependencies,
) {
	let dataPlaneKeyReady = false;
	let dataPlaneKeyRefresh: Promise<boolean> | null = null;

	async function ensureDataPlaneKey(): Promise<void> {
		if (dataPlaneKeyReady || !dependencies.runtime.ensureDataPlaneKey) return;
		dataPlaneKeyRefresh ??= dependencies.runtime
			.ensureDataPlaneKey()
			.finally(() => {
				dataPlaneKeyRefresh = null;
			});
		dataPlaneKeyReady = await dataPlaneKeyRefresh;
		if (!dataPlaneKeyReady) throw new Error("Router API key is unavailable");
	}

	function runtimeCredentials(): RoutingClientCredentials {
		const status = dependencies.runtime.getStatus();
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
				await ensureDataPlaneKey();
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
