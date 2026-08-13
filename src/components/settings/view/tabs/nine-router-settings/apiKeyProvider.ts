import type {
	RoutingOpenAiProviderNodeApiType,
	RoutingProviderNodeType,
} from "../../../../../../shared/routing.js";

import type { NineRouterProviderProfile } from "./ProviderCatalog.js";
import type { createRoutingApiClient } from "./routingApi.js";

export type ApiKeyProviderDraft = {
	name: string;
	prefix: string;
	type: RoutingProviderNodeType;
	apiType: RoutingOpenAiProviderNodeApiType;
	baseUrl: string;
	apiKey: string;
	modelId: string;
};

export type ApiKeyProviderDraftErrors = Partial<
	Record<keyof ApiKeyProviderDraft, string>
>;

type ApiKeyConnectionApi = Pick<
	ReturnType<typeof createRoutingApiClient>,
	"validateProviderNode" | "createProviderNode" | "createAccount"
>;

function prefixForProfile(profile: NineRouterProviderProfile): string {
	return profile.id === "openai-compatible" ? "custom" : profile.id;
}

export function draftForApiKeyProfile(
	profile: NineRouterProviderProfile,
): ApiKeyProviderDraft {
	return {
		name: profile.name,
		prefix: prefixForProfile(profile),
		type: profile.nodeType ?? "openai-compatible",
		apiType: profile.apiType ?? "responses",
		baseUrl: profile.defaultBaseUrl ?? "",
		apiKey: "",
		modelId: "",
	};
}

export function validateApiKeyProviderDraft(
	draft: ApiKeyProviderDraft,
): ApiKeyProviderDraftErrors {
	const errors: ApiKeyProviderDraftErrors = {};
	if (!draft.name.trim()) errors.name = "Name is required.";
	if (!/^[a-z0-9][a-z0-9_-]*$/i.test(draft.prefix))
		errors.prefix = "Use letters, numbers, underscores, or hyphens.";
	try {
		const url = new URL(draft.baseUrl);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash
		)
			throw new Error();
	} catch {
		errors.baseUrl = "Enter a valid HTTP or HTTPS URL.";
	}
	if (!draft.apiKey.trim()) errors.apiKey = "API key is required.";
	return errors;
}

export async function connectApiKeyProvider(
	api: ApiKeyConnectionApi,
	profile: NineRouterProviderProfile,
	draft: ApiKeyProviderDraft,
): Promise<void> {
	const defaultEndpoint =
		profile.defaultBaseUrl?.replace(/\/$/, "") ===
		draft.baseUrl.trim().replace(/\/$/, "");
	let provider = profile.id;
	if (!defaultEndpoint || profile.id === "openai-compatible") {
		const validation = await api.validateProviderNode({
			baseUrl: draft.baseUrl,
			apiKey: draft.apiKey,
			type: draft.type,
			...(draft.modelId ? { modelId: draft.modelId } : {}),
		});
		if (!validation.valid)
			throw new Error(validation.message ?? "Provider validation failed");
		const node = await api.createProviderNode({
			name: profile.name,
			prefix: draft.prefix,
			type: draft.type,
			...(draft.type === "openai-compatible" ? { apiType: draft.apiType } : {}),
			baseUrl: draft.baseUrl,
		});
		provider = node.id;
	}
	await api.createAccount({
		provider,
		name: draft.name,
		apiKey: draft.apiKey,
	});
}
