import { appConfigDb } from "@/modules/database/index.js";
import { AppError } from "@/shared/utils.js";

import { createCodexOAuthCallbackBridge } from "./codex-oauth-callback-bridge.js";
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
		throw new AppError("The Router configuration is invalid", {
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

const codexOAuthCallbackBridge = createCodexOAuthCallbackBridge({
	host: process.env.CODEX_OAUTH_CALLBACK_HOST ?? "127.0.0.1",
});
const routingOAuthService = createRoutingOAuthService({
	clientForRuntime: () => routingServiceClientForRuntime(),
	codexCallback: codexOAuthCallbackBridge,
});

/** Used by the routing HTTP router to execute authenticated application workflows. */
export const routingService = createRoutingService({
	runtime: {
		getStatus: () => getNineRouterSidecar().getStatus(),
		getInternalCredentials: () =>
			getNineRouterSidecar().getInternalCredentials(),
	},
	clientFactory,
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

function createDefaultNineRouterSidecar(): NineRouterSidecar {
	return createNineRouterSidecarService({
		baseUrl: process.env.NINE_ROUTER_BASE_URL,
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

/** Used by the server composition root to initialize the data-plane key through real management APIs. */
export async function initializeNineRouterDataPlaneKey(): Promise<void> {
	const sidecar = getNineRouterSidecar();
	if (!sidecar.updateInternalCredentials) return;
	const status = sidecar.getStatus();
	const credentials = sidecar.getInternalCredentials();
	const provisionedKey = await provisionDataPlaneKey(
		status.origin,
		credentials.initialPassword,
	);
	if (!provisionedKey || provisionedKey === credentials.dataPlaneKey) return;
	appConfigDb.set(sidecarSecretKeys.dataPlaneKey, provisionedKey);
	sidecar.updateInternalCredentials({
		...credentials,
		dataPlaneKey: provisionedKey,
	});
}

/** Used by diagnostics to report the sidecar state without exposing credentials. */
export function getNineRouterSidecarStatus(): NineRouterSidecarStatus {
	return getNineRouterSidecar().getStatus();
}
