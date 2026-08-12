import { appConfigDb } from "@/modules/database/index.js";
import { applyCustomCodexProvider } from "@/modules/providers/index.js";
import { AppError } from "@/shared/utils.js";

import { NineRouterClient } from "./nine-router-client.js";
import { requestNineRouterJson } from "./nine-router-http.js";
import {
	createNineRouterSidecarService,
	type NineRouterSidecarStatus,
} from "./nine-router-sidecar.service.js";
import { createRoutingOAuthCallbackRouter } from "./routing-oauth-callback.routes.js";
import { createRoutingOAuthService } from "./routing-oauth.service.js";
import { createRoutingRouter } from "./routing.routes.js";
import { createRoutingRuntimeService } from "./routing-runtime.service.js";
import { createRoutingService } from "./routing.service.js";

const sidecarSecretKeys = {
	initialPassword: "nine_router_initial_password",
	dataPlaneKey: "nine_router_data_plane_key",
} as const;
const CLOUDCLI_DATA_PLANE_KEY_NAME = "CloudCLI";

function requestConfiguredSidecar(
	input: Parameters<typeof requestNineRouterJson>[0],
) {
	let sidecarHostname: string;
	try {
		sidecarHostname = new URL(input.baseUrl).hostname;
	} catch {
		throw new AppError("The 9router sidecar configuration is invalid", {
			code: "ROUTING_CONFIGURATION_INVALID",
			statusCode: 500,
		});
	}
	return requestNineRouterJson(input, {
		targetPolicy: {
			allowedHosts: [sidecarHostname],
			allowedHttpHosts: [sidecarHostname],
		},
	});
}

const clientFactory = (credentials: {
	baseUrl: string;
	adminPassword: string;
	dataPlaneKey: string;
}) => {
	return new NineRouterClient({
		...credentials,
		request: (input) => requestConfiguredSidecar(input),
	});
};

function routingServiceClientForRuntime() {
	const sidecar = getNineRouterSidecar();
	const status = sidecar.getStatus();
	const credentials = sidecar.getInternalCredentials();
	return clientFactory({
		baseUrl: status.origin,
		adminPassword: credentials.initialPassword,
		dataPlaneKey: credentials.dataPlaneKey,
	});
}

const routingOAuthService = createRoutingOAuthService({
	clientForRuntime: () => routingServiceClientForRuntime(),
});

/** Used by the routing HTTP router to execute authenticated application workflows. */
export const routingService = createRoutingService({
	runtime: {
		getStatus: () => getNineRouterSidecar().getStatus(),
		getInternalCredentials: () =>
			getNineRouterSidecar().getInternalCredentials(),
	},
	clientFactory,
	codexConfig: {
		applyCustomProvider: ({ baseUrl, apiKey }) =>
			applyCustomCodexProvider({ baseUrl, apiKey }),
	},
	oauth: routingOAuthService,
});

/** Used by provider session creation and run dispatch for sticky per-session routing. */
export const routingRuntimeService = createRoutingRuntimeService({
	runtime: {
		getStatus: () => getNineRouterSidecar().getStatus(),
		getInternalCredentials: () =>
			getNineRouterSidecar().getInternalCredentials(),
	},
});

/** Used by server composition to mount unauthenticated static OAuth callback acks before protected routing routes. */
export const routingOAuthCallbackRoutes = createRoutingOAuthCallbackRouter();

/** Used by the server composition root to mount the protected routing API. */
export const routingRoutes = createRoutingRouter(routingService);

type NineRouterSidecar = ReturnType<typeof createNineRouterSidecarService>;
type ConfigurableNineRouterSidecar = Omit<
	NineRouterSidecar,
	"updateInternalCredentials"
> &
	Partial<Pick<NineRouterSidecar, "updateInternalCredentials">>;
type NineRouterSidecarFactory = () => ConfigurableNineRouterSidecar;
const MAX_HEALTH_PAYLOAD_BYTES = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredInitialPassword(): string {
	const password = process.env.NINE_ROUTER_ADMIN_PASSWORD?.trim();
	return (
		password ||
		appConfigDb.getOrCreateSecret(sidecarSecretKeys.initialPassword, 32)
	);
}

function keyValue(value: unknown): string | null {
	if (!isRecord(value)) return null;
	const key = value.key;
	return typeof key === "string" && key.length > 0 ? key : null;
}

async function authenticateManagement(
	baseUrl: string,
	adminPassword: string,
): Promise<string | null> {
	const statusResult = await requestConfiguredSidecar({
		baseUrl,
		operation: "authStatus",
	});
	if (statusResult.statusCode < 200 || statusResult.statusCode >= 300)
		return null;
	const status = isRecord(statusResult.data) ? statusResult.data : null;
	if (status?.requireLogin !== true) return null;
	if (status.authMode !== "password") return null;

	const loginResult = await requestConfiguredSidecar({
		baseUrl,
		operation: "login",
		body: { password: adminPassword },
	});
	if (loginResult.statusCode < 200 || loginResult.statusCode >= 300)
		return null;
	for (const item of loginResult.headers["set-cookie"] ?? []) {
		const pair = item.split(";", 1)[0]?.trim();
		if (pair?.startsWith("auth_token=") && pair.length > "auth_token=".length)
			return pair;
	}
	return null;
}

async function provisionDataPlaneKey(
	baseUrl: string,
	adminPassword: string,
): Promise<string | null> {
	const cookie = await authenticateManagement(baseUrl, adminPassword);
	const keysResult = await requestConfiguredSidecar({
		baseUrl,
		operation: "keysList",
		cookie: cookie ?? undefined,
	});
	if (
		keysResult.statusCode >= 200 &&
		keysResult.statusCode < 300 &&
		isRecord(keysResult.data) &&
		Array.isArray(keysResult.data.keys)
	) {
		for (const item of keysResult.data.keys) {
			if (isRecord(item) && item.name === CLOUDCLI_DATA_PLANE_KEY_NAME) {
				const existing = keyValue(item);
				if (existing) return existing;
			}
		}
	}

	const created = await requestConfiguredSidecar({
		baseUrl,
		operation: "keyCreate",
		cookie: cookie ?? undefined,
		body: { name: CLOUDCLI_DATA_PLANE_KEY_NAME },
	});
	if (created.statusCode < 200 || created.statusCode >= 300) return null;
	return keyValue(created.data);
}

/** Used by routing module tests to verify official 9router data-plane key provisioning behavior. */
export async function provisionNineRouterDataPlaneKeyForTesting(
	baseUrl: string,
	adminPassword: string,
): Promise<string | null> {
	return provisionDataPlaneKey(baseUrl, adminPassword);
}

async function boundedJson(response: Response): Promise<unknown> {
	const contentLength = response.headers.get("content-length");
	if (
		contentLength !== null &&
		Number(contentLength) > MAX_HEALTH_PAYLOAD_BYTES
	)
		return null;
	const body = await response.text();
	if (Buffer.byteLength(body, "utf8") > MAX_HEALTH_PAYLOAD_BYTES) return null;
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
}

function createRemoteSidecarHealthChecker() {
	return async (baseUrl: string) => {
		const timeout = AbortSignal.timeout(1_000);
		let healthResponse: Response;
		let versionResponse: Response;
		try {
			[healthResponse, versionResponse] = await Promise.all([
				fetch(`${baseUrl}/api/health`, { signal: timeout }),
				fetch(`${baseUrl}/api/version`, { signal: timeout }),
			]);
		} catch {
			return { ok: false };
		}
		if (!healthResponse.ok || !versionResponse.ok) return { ok: false };
		const healthJson = await boundedJson(healthResponse);
		const versionJson = await boundedJson(versionResponse);
		if (
			!isRecord(healthJson) ||
			healthJson.ok !== true ||
			!isRecord(versionJson)
		)
			return { ok: false };
		const currentVersion = versionJson.currentVersion;
		return typeof currentVersion === "string" && currentVersion.length > 0
			? { ok: true, version: currentVersion }
			: { ok: false };
	};
}

/** Used by routing module tests to exercise the production sidecar health adapter. */
export function createRemoteSidecarHealthCheckerForTesting() {
	return createRemoteSidecarHealthChecker();
}

function createDefaultNineRouterSidecar(): NineRouterSidecar {
	return createNineRouterSidecarService({
		baseUrl: process.env.NINE_ROUTER_BASE_URL,
		health: createRemoteSidecarHealthChecker(),
		credentials: {
			initialPassword: configuredInitialPassword(),
			dataPlaneKey: appConfigDb.getOrCreateSecret(
				sidecarSecretKeys.dataPlaneKey,
				32,
			),
		},
	});
}

let nineRouterSidecar: ConfigurableNineRouterSidecar | null = null;
let nineRouterSidecarFactory: NineRouterSidecarFactory =
	createDefaultNineRouterSidecar;

function getNineRouterSidecar(): ConfigurableNineRouterSidecar {
	nineRouterSidecar ??= nineRouterSidecarFactory();
	return nineRouterSidecar;
}

/** Used by routing lifecycle tests to replace the sidecar health adapter without owning a process. */
export function configureNineRouterSidecarForTesting(
	factory: NineRouterSidecarFactory,
): void {
	nineRouterSidecarFactory = factory;
	nineRouterSidecar = null;
}

/** Used by routing lifecycle tests to restore the production sidecar factory. */
export function resetNineRouterSidecarForTesting(): void {
	nineRouterSidecarFactory = createDefaultNineRouterSidecar;
	nineRouterSidecar = null;
}

/** Used by the server composition root after database initialization to refresh sidecar health. */
export async function refreshNineRouterSidecar() {
	const sidecar = getNineRouterSidecar();
	const status = await sidecar.refresh();
	if (status.state !== "ready") return status;
	if (!sidecar.updateInternalCredentials) return status;
	const credentials = sidecar.getInternalCredentials();
	const provisionedKey = await provisionDataPlaneKey(
		status.origin,
		credentials.initialPassword,
	);
	if (provisionedKey && provisionedKey !== credentials.dataPlaneKey) {
		appConfigDb.set(sidecarSecretKeys.dataPlaneKey, provisionedKey);
		sidecar.updateInternalCredentials({
			...credentials,
			dataPlaneKey: provisionedKey,
		});
	}
	return status;
}

/** Used by diagnostics to report the sidecar state without exposing credentials. */
export function getNineRouterSidecarStatus(): NineRouterSidecarStatus {
	return getNineRouterSidecar().getStatus();
}
