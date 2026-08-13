import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type {
	CreateRoutingApiKeyAccountInput,
	RoutingSettingsView,
	UpdateRoutingAccountInput,
} from "../../../../../../shared/routing.js";

import {
	routingApi,
	RoutingApiError,
	type RoutingSettingsDetails,
} from "./routingApi.js";
import {
	accountDraftAfterMutation,
	createInitialRoutingState,
	createRoutingRequestCoordinator,
	routingStateReducer,
	shouldLoadRoutingDetails,
	type RoutingAccountDraft,
	type RoutingDetailKey,
	type RoutingState,
	type RoutingUiError,
} from "./routingState.js";

const UPSTREAM_DETAIL_KEYS: RoutingDetailKey[] = ["accounts", "models"];

function safeUiError(error: unknown): RoutingUiError {
	if (error instanceof RoutingApiError) {
		return {
			code: error.code,
			message: error.message,
			status: error.status,
			retryable: error.retryable,
		};
	}

	return {
		code: "ROUTING_OPERATION_FAILED",
		message: "The routing operation could not be completed.",
		status: 0,
		retryable: true,
	};
}

function loadedDetails(
	state: RoutingState,
	required: RoutingSettingsDetails = {},
	includeLoading = false,
): RoutingSettingsDetails {
	const details: RoutingSettingsDetails = { ...required };
	const requested = (key: RoutingDetailKey) =>
		state.detailStatus[key] === "loaded" ||
		(includeLoading && state.detailStatus[key] === "loading");
	if (requested("accounts")) details.accounts = true;
	if (requested("models")) details.models = true;
	return details;
}

function detailKeysFor(details: RoutingSettingsDetails): RoutingDetailKey[] {
	const keys: RoutingDetailKey[] = [];
	if (details.accounts) keys.push("accounts");
	if (details.models) keys.push("models");
	return keys;
}

/** Owns remote and write-only account state for Provider Router settings surfaces. */
export function useNineRouterSettings() {
	const [state, dispatch] = useReducer(
		routingStateReducer,
		undefined,
		createInitialRoutingState,
	);
	const [accountDraft, setAccountDraft] = useState<RoutingAccountDraft>({
		provider: "",
		name: "",
		apiKey: "",
		active: true,
	});
	const stateRef = useRef(state);
	const detailRequestsRef = useRef(new Set<RoutingDetailKey>());
	const mutationRef = useRef<string | null>(null);
	const requestCoordinatorRef = useRef(createRoutingRequestCoordinator());
	stateRef.current = state;

	const applySettings = useCallback(
		(details: RoutingSettingsDetails, settings: RoutingSettingsView) => {
			const keys = detailKeysFor(details);
			dispatch(
				keys.length > 0
					? { type: "detailsSucceeded", keys, settings }
					: { type: "loadSucceeded", settings },
			);
		},
		[],
	);

	const loadSettings = useCallback(async () => {
		dispatch({ type: "loadStarted" });
		const details = loadedDetails(stateRef.current, {}, true);
		const token = requestCoordinatorRef.current.startAggregate();
		try {
			const settings = await routingApi.getSettings(details);
			if (!requestCoordinatorRef.current.isCurrentAggregate(token)) return;
			applySettings(details, settings);
		} catch (error) {
			if (!requestCoordinatorRef.current.isCurrentAggregate(token)) return;
			dispatch({ type: "loadFailed", error: safeUiError(error) });
		}
	}, [applySettings]);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	const ensureDetails = useCallback(
		async (
			keys: RoutingDetailKey[],
			details: RoutingSettingsDetails,
			force = false,
		) => {
			const pending = keys.filter(
				(key) =>
					force ||
					(stateRef.current.detailStatus[key] === undefined &&
						!detailRequestsRef.current.has(key)),
			);
			if (
				pending.length === 0 ||
				(!force && !shouldLoadRoutingDetails(stateRef.current, pending))
			) {
				return;
			}

			for (const key of pending) detailRequestsRef.current.add(key);
			dispatch({ type: "detailsStarted", keys: pending });
			const token = requestCoordinatorRef.current.startDetail();
			try {
				const settings = await routingApi.getSettings(details);
				if (!requestCoordinatorRef.current.isCurrentDetail(token)) return;
				dispatch({ type: "detailsSucceeded", keys: pending, settings });
			} catch (error) {
				if (!requestCoordinatorRef.current.isCurrentDetail(token)) return;
				dispatch({
					type: "detailsFailed",
					keys: pending,
					error: safeUiError(error),
				});
			} finally {
				if (requestCoordinatorRef.current.isCurrentDetail(token)) {
					for (const key of pending) detailRequestsRef.current.delete(key);
				}
			}
		},
		[],
	);

	const ensureUpstreamDetails = useCallback(
		() =>
			ensureDetails(UPSTREAM_DETAIL_KEYS, {
				accounts: true,
				models: true,
			}),
		[ensureDetails],
	);

	const retryDetails = useCallback(
		(keys: RoutingDetailKey[], details: RoutingSettingsDetails) => {
			for (const key of keys) detailRequestsRef.current.delete(key);
			dispatch({ type: "detailsReset", keys });
			return ensureDetails(keys, details, true);
		},
		[ensureDetails],
	);

	const retryUpstreamDetails = useCallback(
		() =>
			retryDetails(UPSTREAM_DETAIL_KEYS, {
				accounts: true,
				models: true,
			}),
		[retryDetails],
	);

	const refreshAfterMutation = useCallback(
		async (required: RoutingSettingsDetails = {}, resetDetails = false) => {
			const details = resetDetails
				? required
				: loadedDetails(stateRef.current, required, true);
			const keys = detailKeysFor(details);
			const token = requestCoordinatorRef.current.startAggregate();
			try {
				const settings = await routingApi.getSettings(details);
				if (requestCoordinatorRef.current.isCurrentAggregate(token)) {
					applySettings(details, settings);
				}
				return true;
			} catch (error) {
				for (const key of keys) detailRequestsRef.current.delete(key);
				dispatch({
					type: "mutationRefreshFailed",
					keys,
					error: safeUiError(error),
				});
				return false;
			}
		},
		[applySettings],
	);

	const runMutation = useCallback(
		async <T>(
			key: string,
			operation: () => Promise<T>,
			requiredDetails: RoutingSettingsDetails = {},
			onOperationSuccess?: (result: T) => void,
			resetDetails = false,
			refresh = true,
		): Promise<T | null> => {
			if (mutationRef.current) return null;
			mutationRef.current = key;
			dispatch({ type: "mutationStarted", key });

			let result: T;
			try {
				result = await operation();
				const interruptedDetails = [...detailRequestsRef.current];
				detailRequestsRef.current.clear();
				requestCoordinatorRef.current.invalidateReads();
				if (interruptedDetails.length > 0) {
					dispatch({ type: "detailsStarted", keys: interruptedDetails });
				}
				onOperationSuccess?.(result);
			} catch (error) {
				mutationRef.current = null;
				dispatch({ type: "mutationFailed", error: safeUiError(error) });
				return null;
			}

			try {
				if (
					!refresh ||
					(await refreshAfterMutation(requiredDetails, resetDetails))
				) {
					dispatch({ type: "mutationSucceeded", key });
				}
			} finally {
				mutationRef.current = null;
			}
			return result;
		},
		[refreshAfterMutation],
	);

	const applyToCodex = useCallback(
		() =>
			runMutation(
				"codex:apply",
				() => routingApi.applyToCodex(),
				{},
				undefined,
				false,
				false,
			),
		[runMutation],
	);

	const createAccount = useCallback(
		(input: CreateRoutingApiKeyAccountInput = accountDraft) =>
			runMutation(
				"account:create",
				() => routingApi.createAccount(input),
				{ accounts: true, models: true },
				() =>
					setAccountDraft((current) =>
						accountDraftAfterMutation(current, true),
					),
			),
		[accountDraft, runMutation],
	);

	const updateAccount = useCallback(
		(id: string, input: UpdateRoutingAccountInput) =>
			runMutation(
				`account:update:${id}`,
				() => routingApi.updateAccount(id, input),
				{ accounts: true, models: true },
			),
		[runMutation],
	);

	const testAccount = useCallback(
		(id: string) =>
			runMutation(`account:test:${id}`, () => routingApi.testAccount(id), {
				accounts: true,
			}),
		[runMutation],
	);

	const deleteAccount = useCallback(
		(id: string) =>
			runMutation(
				`account:delete:${id}`,
				async () => {
					await routingApi.deleteAccount(id);
					return true;
				},
				{ accounts: true, models: true },
			),
		[runMutation],
	);

	const setAccountField = useCallback(
		<Key extends keyof RoutingAccountDraft>(
			field: Key,
			value: RoutingAccountDraft[Key],
		) => {
			setAccountDraft((current) => ({ ...current, [field]: value }));
		},
		[],
	);

	const clearError = useCallback(() => dispatch({ type: "clearError" }), []);
	const isMutating = useCallback(
		(key: string) => state.activeMutation === key,
		[state.activeMutation],
	);

	return {
		...state,
		accountDraft,
		setAccountDraft,
		setAccountField,
		loadSettings,
		ensureUpstreamDetails,
		retryUpstreamDetails,
		applyToCodex,
		createAccount,
		updateAccount,
		testAccount,
		deleteAccount,
		clearError,
		isMutating,
	};
}
