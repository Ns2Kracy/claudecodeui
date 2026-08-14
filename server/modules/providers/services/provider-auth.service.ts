import { providerRegistry } from "@/modules/providers/provider.registry.js";
import type { LLMProvider, ProviderAuthStatus } from "@/shared/types.js";

type RoutedAccount = {
	provider: string;
	name: string;
	authType: string;
	active: boolean;
	status: string;
};

type ProviderAuthServiceDependencies = {
	listRoutingAccounts(): Promise<RoutedAccount[]>;
	getCodexInstallationStatus(): Promise<boolean>;
};

/**
 * Creates the provider auth application service. Provider tests inject the
 * routing account query; production resolves it lazily through the routing
 * barrel to avoid a providers/routing composition cycle at module startup.
 */
export function createProviderAuthService(
	dependencies: ProviderAuthServiceDependencies,
) {
	return {
		/** Returns Codex installation state and 9Router-owned authentication state. */
		async getProviderAuthStatus(
			providerName: string,
		): Promise<ProviderAuthStatus> {
			providerRegistry.resolveProvider(providerName);
			const installed = await dependencies.getCodexInstallationStatus();

			try {
				const accounts = await dependencies.listRoutingAccounts();
				const account = accounts.find(
					(candidate) =>
						candidate.active &&
						candidate.status !== "failed" &&
						(candidate.provider === "codex" || candidate.provider === "openai"),
				);
				if (account) {
					return {
						installed,
						provider: "codex",
						authenticated: true,
						email: account.name,
						method: `9router:${account.authType}`,
					};
				}

				return {
					installed,
					provider: "codex",
					authenticated: false,
					email: null,
					method: null,
				};
			} catch {
				return {
					installed,
					provider: "codex",
					authenticated: false,
					email: null,
					method: null,
				};
			}
		},

		/**
		 * Returns whether the Codex runtime appears installed. Falls back to true
		 * if lookup fails so callers retain the original runtime error.
		 */
		async isProviderInstalled(providerName: LLMProvider): Promise<boolean> {
			try {
				providerRegistry.resolveProvider(providerName);
				return await dependencies.getCodexInstallationStatus();
			} catch {
				return true;
			}
		},
	};
}

export const providerAuthService = createProviderAuthService({
	async listRoutingAccounts() {
		const { routingService } = await import("@/modules/routing/index.js");
		return routingService.listAccounts(0);
	},
	async getCodexInstallationStatus() {
		const status = await providerRegistry
			.resolveProvider("codex")
			.auth.getStatus();
		return status.installed;
	},
});
