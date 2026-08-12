import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sessionsDb } from "@/modules/database/index.js";
import { providerRegistry } from "@/modules/providers/provider.registry.js";
import {
	routingService,
	type RoutingModelView,
} from "@/modules/routing/index.js";
import type { IProvider } from "@/shared/interfaces.js";
import { AppError } from "@/shared/utils.js";
import type {
	LLMProvider,
	ProviderCurrentActiveModel,
	ProviderModelsCacheInfo,
	ProviderModelsDefinition,
	ProviderModelsResult,
	ProviderSessionModel,
} from "@/shared/types.js";

export const PROVIDER_MODELS_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PROVIDER_MODELS_CACHE_VERSION = 2;
const UNCACHED_PROVIDERS = new Set<LLMProvider>(["claude"]);

/** Session-row access the service needs, narrowed so tests can stub it. */
type ProviderModelsSessionStore = {
	getSessionById(sessionId: string): {
		model: string | null;
		model_source?: "native" | "9router" | null;
	} | null;
	setSessionModel(
		sessionId: string,
		model: string,
		source?: "native" | "9router" | null,
	): void;
};

type ProviderModelsServiceDependencies = {
	resolveProvider?: (provider: LLMProvider) => Pick<IProvider, "models">;
	listRoutingModels?: () => Promise<RoutingModelView[]>;
	cachePath?: string;
	sessions?: ProviderModelsSessionStore;
	now?: () => number;
};

type ProviderModelsOptions = {
	bypassCache?: boolean;
};

type ProviderModelsCacheEntry = {
	updatedAt: number;
	expiresAt: number;
	models: ProviderModelsDefinition;
};

type ProviderModelsCacheFile = {
	version: number;
	entries: Record<string, ProviderModelsCacheEntry>;
};

const getProviderModelsCachePath = (): string =>
	path.join(os.homedir(), ".cloudcli", "provider-models-cache.json");

const toProviderModelsCacheInfo = (
	entry: ProviderModelsCacheEntry,
	source: ProviderModelsCacheInfo["source"],
): ProviderModelsCacheInfo => ({
	updatedAt: new Date(entry.updatedAt).toISOString(),
	expiresAt: new Date(entry.expiresAt).toISOString(),
	source,
});

const isProviderModelOption = (
	value: unknown,
): value is ProviderModelsDefinition["OPTIONS"][number] =>
	Boolean(value) &&
	typeof value === "object" &&
	typeof (value as ProviderModelsDefinition["OPTIONS"][number]).value ===
		"string" &&
	typeof (value as ProviderModelsDefinition["OPTIONS"][number]).label ===
		"string" &&
	(typeof (value as ProviderModelsDefinition["OPTIONS"][number]).description ===
		"undefined" ||
		typeof (value as ProviderModelsDefinition["OPTIONS"][number])
			.description === "string");

const isProviderModelsDefinition = (
	value: unknown,
): value is ProviderModelsDefinition =>
	Boolean(value) &&
	typeof value === "object" &&
	Array.isArray((value as ProviderModelsDefinition).OPTIONS) &&
	(value as ProviderModelsDefinition).OPTIONS.every(isProviderModelOption) &&
	typeof (value as ProviderModelsDefinition).DEFAULT === "string";

const isProviderModelsCacheEntry = (
	value: unknown,
): value is ProviderModelsCacheEntry =>
	Boolean(value) &&
	typeof value === "object" &&
	typeof (value as ProviderModelsCacheEntry).updatedAt === "number" &&
	typeof (value as ProviderModelsCacheEntry).expiresAt === "number" &&
	isProviderModelsDefinition((value as ProviderModelsCacheEntry).models);

const readProviderModelsCacheFile = async (
	cachePath: string,
): Promise<ProviderModelsCacheFile | null> => {
	try {
		const raw = await readFile(cachePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<ProviderModelsCacheFile>;
		if (
			parsed.version !== PROVIDER_MODELS_CACHE_VERSION ||
			!parsed.entries ||
			typeof parsed.entries !== "object"
		) {
			return null;
		}

		const entries = Object.fromEntries(
			Object.entries(parsed.entries).filter(
				(entry): entry is [string, ProviderModelsCacheEntry] =>
					isProviderModelsCacheEntry(entry[1]),
			),
		);

		return {
			version: PROVIDER_MODELS_CACHE_VERSION,
			entries,
		};
	} catch {
		return null;
	}
};

const writeProviderModelsCacheFile = async (
	cachePath: string,
	entries: Map<LLMProvider, ProviderModelsCacheEntry>,
	now: number,
): Promise<void> => {
	const serializableEntries = Object.fromEntries(
		[...entries.entries()].filter(([, entry]) => entry.expiresAt > now),
	);
	const payload: ProviderModelsCacheFile = {
		version: PROVIDER_MODELS_CACHE_VERSION,
		entries: serializableEntries,
	};

	await mkdir(path.dirname(cachePath), { recursive: true });
	await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

/**
 * Provider model lookup service.
 *
 * Routes and other service callers use this layer instead of resolving provider
 * classes directly so the provider-registry dependency stays centralized in one
 * place.
 */
export const createProviderModelsService = (
	dependencies: ProviderModelsServiceDependencies = {},
) => {
	const resolveProvider =
		dependencies.resolveProvider ?? providerRegistry.resolveProvider;
	const listRoutingModels =
		dependencies.listRoutingModels ?? (() => routingService.listModels(0));
	const cachePath = dependencies.cachePath ?? getProviderModelsCachePath();
	const sessions = dependencies.sessions ?? sessionsDb;
	const now = dependencies.now ?? (() => Date.now());
	const memoryCache = new Map<LLMProvider, ProviderModelsCacheEntry>();
	const pendingRequests = new Map<LLMProvider, Promise<ProviderModelsResult>>();
	let persistedCacheLoaded = false;
	let persistedCacheLoadPromise: Promise<void> | null = null;

	const pruneExpiredMemoryEntry = (
		provider: LLMProvider,
		currentTime: number,
		source: ProviderModelsCacheInfo["source"],
	): ProviderModelsResult | null => {
		const cachedEntry = memoryCache.get(provider);
		if (!cachedEntry) {
			return null;
		}

		if (cachedEntry.expiresAt > currentTime) {
			return {
				models: cachedEntry.models,
				cache: toProviderModelsCacheInfo(cachedEntry, source),
			};
		}

		memoryCache.delete(provider);
		return null;
	};

	const loadPersistedCache = async (): Promise<void> => {
		if (persistedCacheLoaded) {
			return;
		}

		if (!persistedCacheLoadPromise) {
			persistedCacheLoadPromise = (async () => {
				const cacheFile = await readProviderModelsCacheFile(cachePath);
				const currentTime = now();

				for (const [provider, entry] of Object.entries(
					cacheFile?.entries ?? {},
				)) {
					if (entry.expiresAt > currentTime) {
						memoryCache.set(provider as LLMProvider, entry);
					}
				}

				persistedCacheLoaded = true;
			})().finally(() => {
				persistedCacheLoadPromise = null;
			});
		}

		await persistedCacheLoadPromise;
	};

	const persistCache = async (): Promise<void> => {
		try {
			await writeProviderModelsCacheFile(cachePath, memoryCache, now());
		} catch (error) {
			console.warn("Unable to persist provider models cache:", error);
		}
	};

	const setCacheEntry = async (
		provider: LLMProvider,
		models: ProviderModelsDefinition,
	): Promise<ProviderModelsCacheEntry> => {
		const currentTime = now();
		const entry: ProviderModelsCacheEntry = {
			updatedAt: currentTime,
			expiresAt: currentTime + PROVIDER_MODELS_CACHE_TTL_MS,
			models,
		};

		memoryCache.set(provider, entry);
		await persistCache();
		return entry;
	};

	const toTitle = (value: string): string =>
		value
			.split(/[-_\s]+/)
			.filter(Boolean)
			.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
			.join(" ");

	const routingModelLabel = (model: RoutingModelView): string => {
		const provider = model.provider.trim();
		const name = model.name.trim();
		return provider ? `${toTitle(provider)} · ${name}` : name;
	};

	const withUnifiedModelCatalog = async (
		models: ProviderModelsDefinition,
	): Promise<ProviderModelsDefinition> => {
		let routingModels: RoutingModelView[];
		try {
			routingModels = await listRoutingModels();
		} catch {
			return models;
		}

		const nativeOptions = models.OPTIONS.map((option) => ({
			...option,
			source: option.source ?? ("native" as const),
		}));
		const existingValues = new Set(nativeOptions.map((option) => option.value));
		const routedIds = new Set(routingModels.map((model) => model.id));
		const collision = nativeOptions.find((option) =>
			routedIds.has(option.value),
		);
		if (collision) {
			throw new AppError(
				"A native and Provider Router model share the same ID",
				{
					code: "PROVIDER_MODEL_ID_COLLISION",
					statusCode: 409,
				},
			);
		}

		const sidecarOptions = routingModels.flatMap((model) => {
			const id = model.id;
			const name = model.name.trim();
			const value = id;
			if (!id.trim() || !name || existingValues.has(value)) return [];
			existingValues.add(value);
			return [
				{
					value,
					label: routingModelLabel({ ...model, id, name }),
					source: "9router" as const,
				},
			];
		});

		if (sidecarOptions.length === 0) return models;
		return {
			...models,
			OPTIONS: [...nativeOptions, ...sidecarOptions],
		};
	};

	const loadAndCacheModels = (
		provider: LLMProvider,
	): Promise<ProviderModelsResult> => {
		const request = resolveProvider(provider)
			.models.getSupportedModels()
			.then(async (models) => {
				const entry = await setCacheEntry(provider, models);
				return {
					models: await withUnifiedModelCatalog(models),
					cache: toProviderModelsCacheInfo(entry, "fresh"),
				};
			})
			.finally(() => {
				pendingRequests.delete(provider);
			});

		pendingRequests.set(provider, request);
		return request;
	};

	const loadDirectModels = (
		provider: LLMProvider,
	): Promise<ProviderModelsResult> => {
		const request = resolveProvider(provider)
			.models.getSupportedModels()
			.then(async (models) => {
				const unifiedModels = await withUnifiedModelCatalog(models);
				const currentTime = now();
				return {
					models: unifiedModels,
					cache: {
						updatedAt: new Date(currentTime).toISOString(),
						expiresAt: new Date(currentTime).toISOString(),
						source: "fresh" as const,
					},
				};
			})
			.finally(() => {
				pendingRequests.delete(provider);
			});

		pendingRequests.set(provider, request);
		return request;
	};

	const getProviderModels = async (
		provider: LLMProvider,
		options: ProviderModelsOptions = {},
	): Promise<ProviderModelsResult> => {
		if (UNCACHED_PROVIDERS.has(provider)) {
			const pendingRequest = pendingRequests.get(provider);
			if (pendingRequest) {
				return pendingRequest;
			}

			return loadDirectModels(provider);
		}

		if (options.bypassCache) {
			const pendingRequest = pendingRequests.get(provider);
			if (pendingRequest) {
				return pendingRequest;
			}

			return loadAndCacheModels(provider);
		}

		const cachedModels = pruneExpiredMemoryEntry(provider, now(), "memory");
		if (cachedModels) {
			return {
				...cachedModels,
				models: await withUnifiedModelCatalog(cachedModels.models),
			};
		}

		const pendingRequest = pendingRequests.get(provider);
		if (pendingRequest) {
			return pendingRequest;
		}

		await loadPersistedCache();

		const persistedModels = pruneExpiredMemoryEntry(provider, now(), "disk");
		if (persistedModels) {
			return {
				...persistedModels,
				models: await withUnifiedModelCatalog(persistedModels.models),
			};
		}

		const postLoadPendingRequest = pendingRequests.get(provider);
		if (postLoadPendingRequest) {
			return postLoadPendingRequest;
		}

		return loadAndCacheModels(provider);
	};

	const getCurrentActiveModel = async (
		provider: LLMProvider,
		sessionId?: string,
	): Promise<ProviderCurrentActiveModel> =>
		resolveProvider(provider).models.getCurrentActiveModel(sessionId);

	const readRecordedSessionModel = (
		sessionId: string,
	): {
		model: string;
		source: "native" | "9router" | null;
	} | null => {
		const session = sessions.getSessionById(sessionId);
		const model = session?.model?.trim();
		return model ? { model, source: session?.model_source ?? null } : null;
	};

	const resolveModelSource = async (
		provider: LLMProvider,
		model: string,
		sessionId?: string | null,
	): Promise<"native" | "9router"> => {
		const recorded = sessionId ? readRecordedSessionModel(sessionId) : null;
		if (recorded?.model === model && recorded.source) {
			return recorded.source;
		}

		const catalog = (await getProviderModels(provider)).models;
		const selected = catalog.OPTIONS.find((option) => option.value === model);
		if (!selected) {
			throw new AppError("The selected model is no longer available", {
				code: "PROVIDER_MODEL_UNAVAILABLE",
				statusCode: 409,
			});
		}
		return selected.source === "9router" ? "9router" : "native";
	};

	/**
	 * Records the model one session runs with.
	 *
	 * Called from the active-model route when the user picks a model and from
	 * `chat.send` on every turn, so the row always matches what the session last
	 * ran with. Sessions the app has not created yet (no row) are ignored rather
	 * than treated as an error: the client keeps its own pending selection and
	 * the value lands on the row with the first send.
	 */
	const setSessionModel = async (
		provider: LLMProvider,
		sessionId: string,
		model: string,
		source?: "native" | "9router",
	): Promise<ProviderSessionModel | null> => {
		const normalizedSessionId = sessionId.trim();
		const normalizedModel = model.trim();
		if (!normalizedSessionId || !normalizedModel) {
			return null;
		}

		if (!sessions.getSessionById(normalizedSessionId)) {
			return null;
		}

		const resolvedSource =
			source ??
			(await resolveModelSource(
				provider,
				normalizedModel,
				normalizedSessionId,
			));
		sessions.setSessionModel(
			normalizedSessionId,
			normalizedModel,
			resolvedSource,
		);
		return {
			provider,
			sessionId: normalizedSessionId,
			model: normalizedModel,
			source: "session",
		};
	};

	/**
	 * Answers "which model is this session using?" for every display surface.
	 *
	 * Precedence, highest first:
	 *   1. the model recorded on the session row — the user's pick, or whatever
	 *      the last send used;
	 *   2. the provider's own session state, for sessions started outside the app
	 *      that we have never recorded a model for;
	 *   3. `requestedModel`, the client's current default, for a chat that has no
	 *      session yet;
	 *   4. the provider catalog default.
	 */
	const resolveSessionModel = async (
		provider: LLMProvider,
		options: { sessionId?: string | null; requestedModel?: string | null } = {},
	): Promise<ProviderSessionModel> => {
		const normalizedSessionId =
			typeof options.sessionId === "string" ? options.sessionId.trim() : "";
		const normalizedRequestedModel =
			typeof options.requestedModel === "string"
				? options.requestedModel.trim()
				: "";

		if (normalizedSessionId) {
			const recordedModel = readRecordedSessionModel(normalizedSessionId);
			if (recordedModel) {
				return {
					provider,
					sessionId: normalizedSessionId,
					model: recordedModel.model,
					source: "session",
				};
			}

			// Never sent on through the app. Ask the provider what its own session
			// state says before falling back to anything client-supplied.
			const catalog = (await getProviderModels(provider)).models;
			const providerModel = await getCurrentActiveModel(
				provider,
				normalizedSessionId,
			);
			const resolvedProviderModel = providerModel.model?.trim();
			if (resolvedProviderModel && resolvedProviderModel !== catalog.DEFAULT) {
				return {
					provider,
					sessionId: normalizedSessionId,
					model: resolvedProviderModel,
					source: "provider",
				};
			}

			return {
				provider,
				sessionId: normalizedSessionId,
				model: normalizedRequestedModel || catalog.DEFAULT,
				source: normalizedRequestedModel ? "session" : "default",
			};
		}

		if (normalizedRequestedModel) {
			return {
				provider,
				sessionId: null,
				model: normalizedRequestedModel,
				source: "session",
			};
		}

		const catalog = (await getProviderModels(provider)).models;
		return {
			provider,
			sessionId: null,
			model: catalog.DEFAULT,
			source: "default",
		};
	};

	/**
	 * Picks the model one run should use, for provider runtime adapters.
	 *
	 * Deliberately narrower than `resolveSessionModel`: the provider's own
	 * session state is not consulted here. Codex reports a global config value
	 * from `getCurrentActiveModel`, which would silently override the model the
	 * user picked in the composer on every single run.
	 */
	const resolveResumeModel = async (
		provider: LLMProvider,
		sessionId: string | undefined,
		requestedModel?: string | null,
	): Promise<string | undefined> => {
		void provider;
		const normalizedRequestedModel =
			typeof requestedModel === "string" ? requestedModel.trim() : "";
		const normalizedSessionId = sessionId?.trim();
		if (!normalizedSessionId) {
			return normalizedRequestedModel || undefined;
		}

		const recordedModel = readRecordedSessionModel(normalizedSessionId);
		return recordedModel?.model || normalizedRequestedModel || undefined;
	};

	const clearCache = (): void => {
		memoryCache.clear();
		pendingRequests.clear();
		persistedCacheLoaded = false;
		persistedCacheLoadPromise = null;
	};

	return {
		getProviderModels,
		resolveModelSource,
		setSessionModel,
		resolveSessionModel,
		resolveResumeModel,
		clearCache,
	};
};

export const providerModelsService = createProviderModelsService();
