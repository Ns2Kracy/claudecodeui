import { authenticatedFetch } from "../../../utils/api";

import { readErrorMessageFromResponse } from "./utils";

type CompleteOnboardingDependencies = {
	fetch: typeof authenticatedFetch;
};

export async function completeOnboardingSetup(
	gitName: string,
	gitEmail: string,
	{ fetch }: CompleteOnboardingDependencies = { fetch: authenticatedFetch },
): Promise<void> {
	const gitResponse = await fetch("/api/user/git-config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ gitName, gitEmail }),
	});
	if (!gitResponse.ok) {
		throw new Error(
			await readErrorMessageFromResponse(
				gitResponse,
				"Failed to save git configuration",
			),
		);
	}

	const response = await fetch("/api/user/complete-onboarding", {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(
			await readErrorMessageFromResponse(
				response,
				"Failed to complete onboarding",
			),
		);
	}
}
