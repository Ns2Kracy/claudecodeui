import { useEffect, useState } from "react";

import { selectConfiguredAgentModel } from "../agents-settings/agentModelSelection.js";

import ProviderAccountsSection from "./ProviderAccountsSection.js";
import { upstreamDetailsState } from "./routingState.js";
import { useNineRouterSettings } from "./useNineRouterSettings.js";

/** Owns the Provider Router account surface shown in Codex agent settings. */
export default function ProviderAccountsManager() {
	const controller = useNineRouterSettings();
	const details = upstreamDetailsState(controller.detailStatus);
	const runtimeStatus = controller.settings.runtime.status;
	const runtimeReady = runtimeStatus === "ready";
	const hasLoadedDetails = controller.settings.accounts !== undefined;
	const detailsError =
		details.error || (runtimeStatus === "degraded" && !hasLoadedDetails);
	const models = controller.settings.models ?? [];
	const [configuredModel, setConfiguredModel] = useState(
		() => localStorage.getItem("codex-model")?.trim() ?? "",
	);
	const selectedModel = selectConfiguredAgentModel(configuredModel, models);

	useEffect(() => {
		if (!selectedModel || selectedModel === configuredModel) return;
		setConfiguredModel(selectedModel);
		localStorage.setItem("codex-model", selectedModel);
	}, [configuredModel, selectedModel]);

	const selectModel = (model: string) => {
		setConfiguredModel(model);
		localStorage.setItem("codex-model", model);
	};

	return (
		<ProviderAccountsSection
			connectionStatus={runtimeReady ? "connected" : "offline"}
			capabilities={controller.settings.runtime.capabilities}
			accounts={controller.settings.accounts ?? []}
			models={models}
			selectedModel={selectedModel}
			onSelectModel={selectModel}
			loading={details.loading}
			hasLoadedDetails={hasLoadedDetails}
			refreshing={details.loading && hasLoadedDetails}
			detailsError={detailsError}
			activeMutation={controller.activeMutation}
			onRetry={() => {
				void controller.retryUpstreamDetails();
			}}
			onUpdateAccount={async (id, input) =>
				Boolean(await controller.updateAccount(id, input))
			}
			onTestAccount={(id) => controller.testAccount(id)}
			onDeleteAccount={async (id) => Boolean(await controller.deleteAccount(id))}
		/>
	);
}
