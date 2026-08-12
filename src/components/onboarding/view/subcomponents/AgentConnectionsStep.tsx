import type {
	ActiveProvider,
	ProviderAuthStatusMap,
} from "../../../provider-auth/types";

import AgentConnectionCard from "./AgentConnectionCard";
import { ONBOARDING_AGENT_CARDS } from "./agentConnectionsState";

type AgentConnectionsStepProps = {
	providerStatuses: ProviderAuthStatusMap;
	onOpenProviderLogin: (provider: ActiveProvider) => void;
};

export default function AgentConnectionsStep({
	providerStatuses,
	onOpenProviderLogin,
}: AgentConnectionsStepProps) {
	return (
		<div className="space-y-4">
			<div className="text-center">
				<h2 className="font-serif text-xl font-bold tracking-tight text-foreground">
					Connect Your AI Agents
				</h2>
				<p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
					Connect Codex through the provider router. This step is optional.
				</p>
			</div>

			<div className="-mr-1 max-h-[38vh] space-y-2 overflow-y-auto pr-1">
				{ONBOARDING_AGENT_CARDS.map((providerCard) => (
					<AgentConnectionCard
						key={providerCard.provider}
						provider={providerCard.provider}
						title={providerCard.title}
						status={providerStatuses[providerCard.provider]}
						connectedClassName={providerCard.connectedClassName}
						iconContainerClassName={providerCard.iconContainerClassName}
						loginButtonClassName={providerCard.loginButtonClassName}
						onLogin={() => onOpenProviderLogin(providerCard.provider)}
					/>
				))}
			</div>

			<p className="text-center text-xs text-muted-foreground">
				You can configure these later in Settings.
			</p>
		</div>
	);
}
