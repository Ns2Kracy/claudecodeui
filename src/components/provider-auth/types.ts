import type { LLMProvider } from "../../types/app";

export type ProviderAuthStatus = {
	authenticated: boolean;
	email: string | null;
	method: string | null;
	error: string | null;
	loading: boolean;
};

export const CLI_PROVIDERS = [
	"codex",
] as const satisfies readonly LLMProvider[];

export type ActiveProvider = (typeof CLI_PROVIDERS)[number];
export type ProviderAuthStatusMap = Record<ActiveProvider, ProviderAuthStatus>;

export const PROVIDER_AUTH_STATUS_ENDPOINTS: Record<
	(typeof CLI_PROVIDERS)[number],
	string
> = {
	codex: "/api/providers/codex/auth/status",
};

export const createInitialProviderAuthStatusMap = (
	loading = true,
): ProviderAuthStatusMap => ({
	codex: {
		authenticated: false,
		email: null,
		method: null,
		error: null,
		loading,
	},
});
