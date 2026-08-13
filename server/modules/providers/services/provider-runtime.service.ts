import { providerRegistry } from "@/modules/providers/provider.registry.js";
import { providerModelsService } from "@/modules/providers/services/provider-models.service.js";
import { sessionsService } from "@/modules/providers/services/sessions.service.js";
import { routingRuntimeService } from "@/modules/routing/index.js";
import type { IProvider } from "@/shared/interfaces.js";
import { AppError } from "@/shared/utils.js";
import type {
	AnyRecord,
	LLMProvider,
	ProviderPermissionDecision,
	ProviderRunFunction,
	ProviderRuntimeContext,
	ProviderRuntimeWriter,
	RuntimeRoutingConfiguration,
} from "@/shared/types.js";

type ProviderRuntimeServiceDependencies = {
	listProviders(): IProvider[];
	resolveProvider(provider: string): IProvider;
	resolveProviderSessionId(sessionId: string | null | undefined): string | null;
	resolveResumeModel(
		provider: LLMProvider,
		sessionId: string | undefined,
		requestedModel?: string | null,
	): Promise<string | undefined>;
	getProviderModels: typeof providerModelsService.getProviderModels;
	resolveRoutingForModel(model: string): Promise<RuntimeRoutingConfiguration>;
};

const defaultDependencies: ProviderRuntimeServiceDependencies = {
	listProviders: () => providerRegistry.listProviders(),
	resolveProvider: (provider) => providerRegistry.resolveProvider(provider),
	resolveProviderSessionId: (sessionId) =>
		sessionsService.resolveProviderSessionId(sessionId),
	resolveResumeModel: (provider, sessionId, requestedModel) =>
		providerModelsService.resolveResumeModel(
			provider,
			sessionId,
			requestedModel,
		),
	getProviderModels: (provider, options) =>
		providerModelsService.getProviderModels(provider, options),
	resolveRoutingForModel: (model) =>
		routingRuntimeService.resolveForModel(model),
};

/**
 * Creates the application-facing provider runtime dispatcher.
 *
 * The provider registry owns each concrete runtime. This service supplies the
 * registry-backed model/session lookups at execution time so runtime adapters
 * never import services that resolve back through the registry.
 */
export function createProviderRuntimeService(
	dependencyOverrides: Partial<ProviderRuntimeServiceDependencies> = {},
) {
	const dependencies = { ...defaultDependencies, ...dependencyOverrides };

	const createRuntimeContext = (
		provider: IProvider,
		routing: RuntimeRoutingConfiguration,
	): ProviderRuntimeContext => ({
		routing,
		resolveProviderSessionId: dependencies.resolveProviderSessionId,
		resolveResumeModel: (sessionId, requestedModel) =>
			dependencies.resolveResumeModel(provider.id, sessionId, requestedModel),
		getProviderModels: async () => {
			const result = await dependencies.getProviderModels(provider.id);
			return result.models;
		},
		normalizeMessage: (raw, sessionId) =>
			provider.sessions.normalizeMessage(raw, sessionId),
		async isProviderInstalled() {
			try {
				return (await provider.auth.getStatus()).installed;
			} catch {
				// Preserve the runtime's original error when installation probing fails.
				return true;
			}
		},
	});

	const run = async (
		providerName: LLMProvider,
		command: string,
		options: AnyRecord,
		writer: ProviderRuntimeWriter,
	): Promise<unknown> => {
		const provider = dependencies.resolveProvider(providerName);
		const requestedModel =
			typeof options.model === "string" ? options.model.trim() : "";
		if (providerName === "codex" && !requestedModel) {
			throw new AppError("A routed Codex model is required", {
				code: "PROVIDER_MODEL_REQUIRED",
				statusCode: 409,
			});
		}

		let routing: RuntimeRoutingConfiguration = { source: "native" };
		if (requestedModel) {
			const suppliedSource =
				options.modelSource === "native" || options.modelSource === "9router"
					? options.modelSource
					: null;
			let source = suppliedSource;
			if (!source) {
				const catalog = (await dependencies.getProviderModels(providerName))
					.models;
				source =
					catalog.OPTIONS.find((option) => option.value === requestedModel)
						?.source ?? null;
			}
			if (!source) {
				throw new AppError("The selected model is no longer available", {
					code: "PROVIDER_MODEL_UNAVAILABLE",
					statusCode: 409,
				});
			}
			if (providerName === "codex" && source !== "9router") {
				throw new AppError("Codex must run through 9Router", {
					code: "CODEX_ROUTING_REQUIRED",
					statusCode: 409,
				});
			}
			if (source === "9router") {
				let routedModel = requestedModel;
				if (!routedModel.includes("/")) {
					const result = await dependencies.getProviderModels(providerName);
					const matches = result.models.OPTIONS.filter(
						(option) =>
							option.source === "9router" &&
							option.value.endsWith(`/${routedModel}`),
					);
					if (matches.length !== 1) {
						throw new AppError("The selected model is no longer available", {
							code: "PROVIDER_MODEL_UNAVAILABLE",
							statusCode: 409,
						});
					}
					routedModel = matches[0].value;
				}
				routing = await dependencies.resolveRoutingForModel(routedModel);
			}
		}

		if (
			providerName === "codex" &&
			(routing.source !== "9router" ||
				!routing.openAiBaseUrl.trim() ||
				!routing.apiKey.trim() ||
				!routing.routeName.trim())
		) {
			throw new AppError("The Codex 9Router configuration is incomplete", {
				code: "CODEX_ROUTING_INVALID",
				statusCode: 409,
			});
		}

		return provider.runtime.run(
			command,
			options,
			writer,
			createRuntimeContext(provider, routing),
		);
	};

	return {
		run,

		hasRuntime(providerName: string): boolean {
			try {
				return Boolean(dependencies.resolveProvider(providerName).runtime);
			} catch {
				return false;
			}
		},

		getRunner(provider: LLMProvider): ProviderRunFunction {
			return (command, options, writer) =>
				run(provider, command, options, writer);
		},

		async abort(
			providerName: LLMProvider,
			sessionId: string,
		): Promise<boolean> {
			return Boolean(
				await dependencies
					.resolveProvider(providerName)
					.runtime.abort(sessionId),
			);
		},

		resolveToolApproval(
			requestId: string,
			decision: ProviderPermissionDecision,
		): void {
			for (const provider of dependencies.listProviders()) {
				provider.runtime.permissions?.resolve(requestId, decision);
			}
		},

		getPendingApprovalsForSession(sessionId: string): unknown[] {
			return dependencies
				.listProviders()
				.flatMap(
					(provider) =>
						provider.runtime.permissions?.listPending(sessionId) ?? [],
				);
		},
	};
}

export const providerRuntimeService = createProviderRuntimeService();
