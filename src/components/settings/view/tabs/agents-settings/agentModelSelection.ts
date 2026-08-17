import type { RoutingModelView } from "../../../../../../shared/routing.js";

export function selectConfiguredAgentModel(
	storedModel: string | null,
	models: RoutingModelView[],
): string {
	return storedModel?.trim() || models[0]?.id || "";
}
