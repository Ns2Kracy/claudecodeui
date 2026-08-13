import { useEffect } from "react";

import ProviderAccountsSection from "./ProviderAccountsSection.js";
import { upstreamDetailsState } from "./routingState.js";
import { useNineRouterSettings } from "./useNineRouterSettings.js";

/** Owns the Provider Router account surface shown in Codex agent settings. */
export default function ProviderAccountsManager() {
	const controller = useNineRouterSettings();
	const details = upstreamDetailsState(controller.detailStatus);
	const runtimeReady = controller.settings.runtime.status === "ready";
	const ensureUpstreamDetails = controller.ensureUpstreamDetails;

	useEffect(() => {
		if (runtimeReady) void ensureUpstreamDetails();
	}, [ensureUpstreamDetails, runtimeReady]);

	return (
		<ProviderAccountsSection
			configured={runtimeReady}
			connectionStatus={runtimeReady ? "connected" : "offline"}
			capabilities={controller.settings.runtime.capabilities}
			accounts={controller.settings.accounts ?? []}
			models={controller.settings.models ?? []}
			loading={details.loading}
			detailsError={details.error}
			activeMutation={controller.activeMutation}
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
		/>
	);
}
