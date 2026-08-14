import { PACKAGED_NINE_ROUTER_VERSION } from "./nine-router-capabilities.js";

type NineRouterSidecarState = "ready" | "unavailable";

type NineRouterSidecarSafeError = {
	code: string;
	message: string;
	retryable: boolean;
};

export type NineRouterSidecarStatus = {
	state: NineRouterSidecarState;
	origin: string;
	version: string | null;
	lastError: NineRouterSidecarSafeError | null;
};

export type NineRouterInternalCredentials = {
	initialPassword: string;
	dataPlaneKey: string;
};

type NineRouterSidecarDependencies = {
	baseUrl?: string;
	credentials?: NineRouterInternalCredentials;
};

function validateBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Router URL must be a valid HTTP or HTTPS origin");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Router URL must use HTTP or HTTPS");
	}
	if (url.username || url.password || url.search || url.hash || !url.hostname) {
		throw new Error(
			"Router URL must not include credentials, query, or fragment",
		);
	}
	return url.toString().replace(/\/$/, "");
}

/**
 * Used by routing module composition and tests to hold the validated origin and
 * internal credentials for the Compose-owned Router. Availability is determined
 * by real Router API requests rather than a separate health or version probe.
 */
export function createNineRouterSidecarService(
	dependencies: NineRouterSidecarDependencies,
) {
	const origin = validateBaseUrl(
		dependencies.baseUrl ??
			process.env.NINE_ROUTER_BASE_URL ??
			"http://9router:20128",
	);
	let credentials = dependencies.credentials ?? {
		initialPassword: "",
		dataPlaneKey: "",
	};
	const status: NineRouterSidecarStatus = {
		state: "ready",
		origin,
		version: PACKAGED_NINE_ROUTER_VERSION,
		lastError: null,
	};

	return {
		getStatus(): NineRouterSidecarStatus {
			return { ...status };
		},

		getInternalCredentials(): NineRouterInternalCredentials {
			return { ...credentials };
		},

		updateInternalCredentials(
			nextCredentials: NineRouterInternalCredentials,
		): void {
			credentials = { ...nextCredentials };
		},
	};
}
