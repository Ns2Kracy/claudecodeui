import type { RoutingCapabilities } from "../../../shared/routing.js";

/** Used by routing composition and clients to match the Router package pinned in this release. */
export const PACKAGED_NINE_ROUTER_VERSION = "0.5.50";

type NineRouterCapabilityProfile = {
	version: string;
	knownVersion: boolean;
	capabilities: RoutingCapabilities;
};

const KNOWN_CAPABILITIES: RoutingCapabilities = {
	readAccounts: true,
	writeApiKeyAccounts: true,
	testAccounts: true,
	readRoutes: true,
	writeRoutes: true,
	readUsage: false,
	claudeRuntime: true,
	codexRuntime: true,
	openCodeRuntime: true,
	cursorRuntime: false,
};

const REDUCED_CAPABILITIES: RoutingCapabilities = {
	readAccounts: false,
	writeApiKeyAccounts: false,
	testAccounts: false,
	readRoutes: false,
	writeRoutes: false,
	readUsage: false,
	claudeRuntime: true,
	codexRuntime: true,
	openCodeRuntime: true,
	cursorRuntime: false,
};

/**
 * Used by NineRouterClient to pin management contracts to inspected stable
 * releases. Unknown semantic versions retain data-plane runtime probes but no
 * guessed management reads or writes.
 */
export function getNineRouterCapabilityProfile(
	version: string,
): NineRouterCapabilityProfile | null {
	const match =
		/^(\d+)\.(\d+)\.(\d+)(-([0-9A-Za-z.-]+))?(\+[0-9A-Za-z.-]+)?$/.exec(
			version,
		);
	if (!match) {
		return null;
	}

	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	const prerelease = match[4];
	const knownVersion =
		major === 0 && minor === 5 && patch >= 45 && prerelease === undefined;

	return {
		version,
		knownVersion,
		capabilities: {
			...(knownVersion ? KNOWN_CAPABILITIES : REDUCED_CAPABILITIES),
		},
	};
}
