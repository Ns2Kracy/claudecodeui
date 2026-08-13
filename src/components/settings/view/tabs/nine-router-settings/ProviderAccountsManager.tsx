import { useEffect } from "react";

import ProviderAccountsSection from "./ProviderAccountsSection.js";
import { upstreamDetailsState } from "./routingState.js";
import { useNineRouterSettings } from "./useNineRouterSettings.js";

type ProviderAccountsManagerProps = {
	defaultOpen?: boolean;
};

/** Owns the Provider Router account surface shown in Codex agent settings. */
export default function ProviderAccountsManager({
	defaultOpen = false,
}: ProviderAccountsManagerProps) {
	const controller = useNineRouterSettings();
	const details = upstreamDetailsState(controller.detailStatus);
	const runtimeReady = controller.settings.runtime.status === "ready";
	const ensureUpstreamDetails = controller.ensureUpstreamDetails;

	useEffect(() => {
		if (defaultOpen && runtimeReady) {
			void ensureUpstreamDetails();
		}
	}, [defaultOpen, ensureUpstreamDetails, runtimeReady]);

	return (
		<ProviderAccountsSection
			configured={runtimeReady}
			connectionStatus={runtimeReady ? "connected" : "offline"}
			capabilities={controller.settings.runtime.capabilities}
			accountSummary={controller.settings.accountSummary}
			accounts={controller.settings.accounts ?? []}
			models={controller.settings.models ?? []}
			loading={details.loading}
			detailsError={details.error}
			activeMutation={controller.activeMutation}
			onExpand={() => {
				void controller.ensureUpstreamDetails();
			}}
			onRetry={() => {
				void controller.retryUpstreamDetails();
			}}
			onUpdateAccount={async (id, input) =>
				Boolean(await controller.updateAccount(id, input))
			}
			onTestAccount={async (id) => Boolean(await controller.testAccount(id))}
			onDeleteAccount={async (id) =>
				Boolean(await controller.deleteAccount(id))
			}
			defaultOpen={defaultOpen}
		/>
	);
}
