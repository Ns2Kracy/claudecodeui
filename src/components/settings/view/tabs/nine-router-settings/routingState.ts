import {
	emptyRoutingSettingsView,
	type CreateRoutingApiKeyAccountInput,
	type RoutingSettingsView,
} from "../../../../../../shared/routing.js";

export type RoutingUiError = {
	code: string;
	message: string;
	status: number;
	retryable: boolean;
};

export type RoutingDetailKey = "accounts" | "models";

export type RoutingDetailStatus = "loading" | "loaded" | "error";
export type RoutingErrorContext = "load" | "details" | "mutation";

export type RoutingRequestToken = {
	epoch: number;
	sequence: number;
};

/** Used by the settings hook to load the always-visible account surface in one request. */
export function initialRoutingDetails() {
	return { accounts: true, models: true } as const;
}

export type RoutingState = {
	settings: RoutingSettingsView;
	loading: boolean;
	error: RoutingUiError | null;
	errorContext: RoutingErrorContext | null;
	activeMutation: string | null;
	detailStatus: Partial<Record<RoutingDetailKey, RoutingDetailStatus>>;
};

export type RoutingAccountDraft = CreateRoutingApiKeyAccountInput;

export type RoutingStateAction =
	| { type: "loadStarted" }
	| { type: "loadSucceeded"; settings: RoutingSettingsView }
	| { type: "loadFailed"; error: RoutingUiError }
	| { type: "detailsStarted"; keys: RoutingDetailKey[] }
	| {
			type: "detailsSucceeded";
			keys: RoutingDetailKey[];
			settings: RoutingSettingsView;
	  }
	| { type: "detailsFailed"; keys: RoutingDetailKey[]; error: RoutingUiError }
	| { type: "detailsReset"; keys: RoutingDetailKey[] }
	| { type: "detailsCleared" }
	| { type: "mutationStarted"; key: string }
	| { type: "mutationSucceeded"; key: string }
	| { type: "mutationFailed"; error: RoutingUiError }
	| {
			type: "mutationRefreshFailed";
			keys: RoutingDetailKey[];
			error: RoutingUiError;
	  }
	| { type: "clearError" };

export function createInitialRoutingState(): RoutingState {
	return {
		settings: emptyRoutingSettingsView(),
		loading: true,
		error: null,
		errorContext: null,
		activeMutation: null,
		detailStatus: {},
	};
}

/** Coordinates aggregate generations and invalidates all reads after a mutation. */
export function createRoutingRequestCoordinator() {
	let epoch = 0;
	let aggregateSequence = 0;

	return {
		startAggregate(): RoutingRequestToken {
			aggregateSequence += 1;
			return { epoch, sequence: aggregateSequence };
		},
		startDetail(): RoutingRequestToken {
			return { epoch, sequence: 0 };
		},
		isCurrentAggregate(token: RoutingRequestToken): boolean {
			return token.epoch === epoch && token.sequence === aggregateSequence;
		},
		isCurrentDetail(token: RoutingRequestToken): boolean {
			return token.epoch === epoch;
		},
		invalidateReads(): void {
			epoch += 1;
			aggregateSequence += 1;
		},
	};
}

function statusesFor(
	current: RoutingState["detailStatus"],
	keys: RoutingDetailKey[],
	status: RoutingDetailStatus,
): RoutingState["detailStatus"] {
	const next = { ...current };
	for (const key of keys) {
		next[key] = status;
	}
	return next;
}

function resetStatuses(
	current: RoutingState["detailStatus"],
	keys: RoutingDetailKey[],
): RoutingState["detailStatus"] {
	const next = { ...current };
	for (const key of keys) {
		delete next[key];
	}
	return next;
}

function mergeSettings(
	current: RoutingSettingsView,
	incoming: RoutingSettingsView,
): RoutingSettingsView {
	return {
		...incoming,
		accounts: incoming.accounts ?? current.accounts,
		models: incoming.models ?? current.models,
	};
}

/** Returns true only before a detail request has started or after an explicit reset. */
export function shouldLoadRoutingDetails(
	state: RoutingState,
	keys: RoutingDetailKey[],
): boolean {
	return keys.some((key) => state.detailStatus[key] === undefined);
}

export function upstreamDetailsState(
	detailStatus: RoutingState["detailStatus"],
): { loading: boolean; error: boolean } {
	const statuses = [detailStatus.accounts, detailStatus.models];
	return {
		loading: statuses.includes("loading"),
		error: statuses.includes("error"),
	};
}

/** Clears only the write-only account key after a successful create operation. */
export function accountDraftAfterMutation(
	draft: RoutingAccountDraft,
	succeeded: boolean,
): RoutingAccountDraft {
	return succeeded ? { ...draft, apiKey: "" } : draft;
}

export function routingStateReducer(
	state: RoutingState,
	action: RoutingStateAction,
): RoutingState {
	switch (action.type) {
		case "loadStarted":
			return { ...state, loading: true, error: null, errorContext: null };
		case "loadSucceeded":
			return {
				...state,
				settings: mergeSettings(state.settings, action.settings),
				loading: false,
				error: null,
				errorContext: null,
			};
		case "loadFailed":
			return {
				...state,
				loading: false,
				error: action.error,
				errorContext: "load",
			};
		case "detailsStarted":
			return {
				...state,
				error: null,
				errorContext: null,
				detailStatus: statusesFor(state.detailStatus, action.keys, "loading"),
			};
		case "detailsSucceeded":
			return {
				...state,
				settings: mergeSettings(state.settings, action.settings),
				loading: false,
				error: null,
				errorContext: null,
				detailStatus: statusesFor(state.detailStatus, action.keys, "loaded"),
			};
		case "detailsFailed":
			return {
				...state,
				error: action.error,
				errorContext: "details",
				detailStatus: statusesFor(state.detailStatus, action.keys, "error"),
			};
		case "detailsReset":
			return {
				...state,
				detailStatus: resetStatuses(state.detailStatus, action.keys),
			};
		case "detailsCleared": {
			const {
				accounts: _accounts,
				models: _models,
				...aggregateSettings
			} = state.settings;
			return {
				...state,
				settings: aggregateSettings,
				detailStatus: {},
			};
		}
		case "mutationStarted":
			return {
				...state,
				activeMutation: action.key,
				error: null,
				errorContext: null,
			};
		case "mutationSucceeded":
			return {
				...state,
				loading: false,
				activeMutation: null,
				error: null,
				errorContext: null,
			};
		case "mutationFailed":
			return {
				...state,
				loading: false,
				activeMutation: null,
				error: action.error,
				errorContext: "mutation",
			};
		case "mutationRefreshFailed":
			return {
				...state,
				loading: false,
				activeMutation: null,
				error: action.error,
				errorContext: action.keys.length > 0 ? "details" : "mutation",
				detailStatus:
					action.keys.length > 0
						? statusesFor(state.detailStatus, action.keys, "error")
						: state.detailStatus,
			};
		case "clearError":
			return { ...state, error: null, errorContext: null };
		default:
			return state;
	}
}
