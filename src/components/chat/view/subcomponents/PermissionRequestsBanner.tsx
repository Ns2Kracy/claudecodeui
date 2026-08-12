import { ShieldAlertIcon } from "lucide-react";

import type { PendingPermissionRequest } from "../../types/types";
import {
	getPermissionPanel,
	registerPermissionPanel,
} from "../../tools/configs/permissionPanelRegistry";
import { AskUserQuestionPanel } from "../../tools/components/InteractiveRenderers";
import {
	Confirmation,
	ConfirmationTitle,
	ConfirmationRequest,
	ConfirmationActions,
	ConfirmationAction,
} from "../../../../shared/view/ui";

registerPermissionPanel("AskUserQuestion", AskUserQuestionPanel);

type PermissionRequestsBannerProps = {
	pendingPermissionRequests: PendingPermissionRequest[];
	handlePermissionDecision: (
		requestIds: string | string[],
		decision: { allow?: boolean; message?: string; updatedInput?: unknown },
	) => void;
};

function formatToolInputForDisplay(input: unknown): string {
	if (typeof input === "string") return input;
	if (input == null) return "";
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

export default function PermissionRequestsBanner({
	pendingPermissionRequests,
	handlePermissionDecision,
}: PermissionRequestsBannerProps) {
	const filteredRequests = pendingPermissionRequests.filter(
		(request) =>
			request.toolName !== "ExitPlanMode" &&
			request.toolName !== "exit_plan_mode",
	);

	if (!filteredRequests.length) return null;

	return (
		<div className="mb-3 space-y-2">
			{filteredRequests.map((request) => {
				const CustomPanel = getPermissionPanel(request.toolName);
				if (CustomPanel) {
					return (
						<CustomPanel
							key={request.requestId}
							request={request}
							onDecision={handlePermissionDecision}
						/>
					);
				}

				const rawInput = formatToolInputForDisplay(request.input);
				return (
					<Confirmation key={request.requestId} approval="pending">
						<ConfirmationTitle className="flex items-start gap-3">
							<ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
							<ConfirmationRequest>
								<span className="font-medium text-foreground">
									Permission required
								</span>
								<span className="ml-2 text-muted-foreground">
									Tool:{" "}
									<code className="rounded bg-muted px-1.5 py-0.5 text-xs">
										{request.toolName}
									</code>
								</span>
							</ConfirmationRequest>
						</ConfirmationTitle>

						{rawInput && (
							<details className="mt-2">
								<summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
									View tool input
								</summary>
								<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">
									{rawInput}
								</pre>
							</details>
						)}

						<ConfirmationActions>
							<ConfirmationAction
								variant="outline"
								onClick={() =>
									handlePermissionDecision(request.requestId, {
										allow: false,
										message: "User denied tool use",
									})
								}
							>
								Deny
							</ConfirmationAction>
							<ConfirmationAction
								variant="default"
								onClick={() =>
									handlePermissionDecision(request.requestId, { allow: true })
								}
							>
								Allow
							</ConfirmationAction>
						</ConfirmationActions>
					</Confirmation>
				);
			})}
		</div>
	);
}
