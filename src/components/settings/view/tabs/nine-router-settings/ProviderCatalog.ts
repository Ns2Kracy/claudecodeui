import type {
	RoutingOpenAiProviderNodeApiType,
	RoutingProviderConnectionMethod,
	RoutingProviderNodeType,
} from "../../../../../../shared/routing.js";

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
	group: "oauth" | "api_key";
	icon: NineRouterProviderIcon;
	methods: RoutingProviderConnectionMethod[];
	defaultBaseUrl?: string;
	nodeType?: RoutingProviderNodeType;
	apiType?: RoutingOpenAiProviderNodeApiType;
};

export const NINE_ROUTER_PROVIDER_PROFILES: NineRouterProviderProfile[] = [
	{
		id: "codex",
		name: "Codex",
		description: "",
		group: "oauth",
		icon: "codex",
		methods: ["oauth"],
	},
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT and o-series models.",
		group: "api_key",
		icon: "openai",
		methods: ["api_key"],
		defaultBaseUrl: "https://api.openai.com/v1",
		nodeType: "openai-compatible",
		apiType: "responses",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek chat and reasoning models.",
		group: "api_key",
		icon: "deepseek",
		methods: ["api_key"],
		defaultBaseUrl: "https://api.deepseek.com/v1",
		nodeType: "openai-compatible",
		apiType: "chat",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "One API key for models across providers.",
		group: "api_key",
		icon: "openrouter",
		methods: ["api_key"],
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		nodeType: "openai-compatible",
		apiType: "chat",
	},
	{
		id: "openai-compatible",
		name: "OpenAI Compatible",
		description: "Connect another OpenAI-compatible endpoint.",
		group: "api_key",
		icon: "compatible",
		methods: ["api_key"],
		defaultBaseUrl: "",
		nodeType: "openai-compatible",
		apiType: "responses",
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
