import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "../../../utils/api";

import { completeOnboardingSetup } from "./completeOnboardingSetup";
import GitConfigurationStep from "./subcomponents/GitConfigurationStep";
import { gitEmailPattern } from "./utils";

type OnboardingProps = {
	onComplete?: () => void | Promise<void>;
};

export default function Onboarding({ onComplete }: OnboardingProps) {
	const [gitName, setGitName] = useState("");
	const [gitEmail, setGitEmail] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");

	const loadGitConfig = useCallback(async () => {
		try {
			const response = await authenticatedFetch("/api/user/git-config");
			if (!response.ok) {
				return;
			}

			const payload = (await response.json()) as {
				gitName?: string;
				gitEmail?: string;
			};
			if (payload.gitName) {
				setGitName(payload.gitName);
			}
			if (payload.gitEmail) {
				setGitEmail(payload.gitEmail);
			}
		} catch (caughtError) {
			console.error("Error loading git config:", caughtError);
		}
	}, []);

	useEffect(() => {
		void loadGitConfig();
	}, [loadGitConfig]);

	const handleFinish = async () => {
		setErrorMessage("");
		if (!gitName.trim() || !gitEmail.trim()) {
			setErrorMessage("Both git name and email are required.");
			return;
		}
		if (!gitEmailPattern.test(gitEmail)) {
			setErrorMessage("Please enter a valid email address.");
			return;
		}

		setIsSubmitting(true);
		try {
			await completeOnboardingSetup(gitName, gitEmail);
			await onComplete?.();
		} catch (caughtError) {
			setErrorMessage(
				caughtError instanceof Error
					? caughtError.message
					: "Failed to complete onboarding",
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const isFormValid = Boolean(
		gitName.trim() && gitEmail.trim() && gitEmailPattern.test(gitEmail),
	);

	return (
		<div className="relative h-screen overflow-y-auto bg-background">
			<div aria-hidden className="pointer-events-none fixed inset-0">
				<div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
				<div className="absolute -bottom-32 -left-24 h-[26rem] w-[26rem] rounded-full bg-primary/5 blur-3xl" />
				<div className="absolute inset-0 bg-[radial-gradient(hsl(var(--foreground)/0.04)_1px,transparent_1px)] opacity-60 [background-size:22px_22px]" />
			</div>

			<div className="relative mx-auto flex min-h-full w-full max-w-2xl items-center justify-center p-4">
				<div className="w-full py-6">
					<div className="rounded-2xl border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_-20px_hsl(var(--foreground)/0.18)] ring-1 ring-foreground/5 backdrop-blur-xl">
						<GitConfigurationStep
							gitName={gitName}
							gitEmail={gitEmail}
							isSubmitting={isSubmitting}
							onGitNameChange={setGitName}
							onGitEmailChange={setGitEmail}
						/>

						{errorMessage && (
							<div
								role="alert"
								className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5"
							>
								<p className="text-sm text-destructive">{errorMessage}</p>
							</div>
						)}

						<div className="mt-6 flex justify-end border-t border-border pt-5">
							<button
								onClick={handleFinish}
								disabled={!isFormValid || isSubmitting}
								className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 font-medium text-white shadow-lg shadow-emerald-600/25 transition-all duration-200 hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
							>
								{isSubmitting ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										Completing...
									</>
								) : (
									<>
										<Check className="h-4 w-4" />
										Complete Setup
									</>
								)}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
