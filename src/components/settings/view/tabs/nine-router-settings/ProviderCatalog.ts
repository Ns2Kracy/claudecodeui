import type { RoutingProviderConnectionMethod } from "../../../../../../shared/routing.js";

export type NineRouterProviderIcon =
	| "codex"
	| "openai"
	| "anthropic"
	| "gemini"
	| "deepseek"
	| "openrouter"
	| "compatible";

export type NineRouterProviderProfile = {
	id: string;
	name: string;
	description: string;
	group: "oauth" | "popular" | "custom";
	icon: NineRouterProviderIcon;
	methods: RoutingProviderConnectionMethod[];
};

export const NINE_ROUTER_PROVIDER_PROFILES: NineRouterProviderProfile[] = [
	{
		id: "codex",
		name: "Codex",
		description: "Use your ChatGPT account through 9Router.",
		group: "oauth",
		icon: "codex",
		methods: ["oauth"],
	},
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT and o-series models.",
		group: "popular",
		icon: "openai",
		methods: ["api_key"],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude models with an Anthropic API key.",
		group: "popular",
		icon: "anthropic",
		methods: ["api_key"],
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Gemini models from Google AI Studio.",
		group: "popular",
		icon: "gemini",
		methods: ["api_key"],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek chat and reasoning models.",
		group: "popular",
		icon: "deepseek",
		methods: ["api_key"],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "One API key for models across providers.",
		group: "popular",
		icon: "openrouter",
		methods: ["api_key"],
	},
	{
		id: "openai-compatible",
		name: "OpenAI Compatible",
		description: "Connect another OpenAI-compatible endpoint.",
		group: "custom",
		icon: "compatible",
		methods: ["custom"],
	},
];

export function methodsForProvider(
	provider: string,
): RoutingProviderConnectionMethod[] {
	return (
		NINE_ROUTER_PROVIDER_PROFILES.find((profile) => profile.id === provider)
			?.methods ?? []
	);
}
