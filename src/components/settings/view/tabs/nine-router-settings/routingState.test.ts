import assert from "node:assert/strict";
import test from "node:test";

import { emptyRoutingSettingsView } from "../../../../../../shared/routing.js";

import {
	createInitialRoutingState,
	createRoutingRequestCoordinator,
	routingStateReducer,
	shouldLoadRoutingDetails,
	upstreamDetailsState,
} from "./routingState.js";

const safeError = {
	code: "ROUTING_OPERATION_FAILED",
	message: "The operation failed",
	status: 502,
	retryable: true,
};

test("routing state starts secret-free and loads aggregate settings", () => {
	const initial = createInitialRoutingState();
	const secretText = JSON.stringify(initial);
	assert.equal(secretText.includes("adminPassword"), false);
	assert.equal(secretText.includes("dataPlaneKey"), false);

	const settings = emptyRoutingSettingsView();
	const loaded = routingStateReducer(initial, {
		type: "loadSucceeded",
		settings,
	});
	assert.equal(loaded.loading, false);
	assert.deepEqual(loaded.settings.accountSummary, { total: 0, degraded: 0 });
	assert.equal(loaded.error, null);
});

test("expanded detail sections trigger one read until explicitly retried", () => {
	const initial = createInitialRoutingState();
	assert.equal(shouldLoadRoutingDetails(initial, ["accounts", "models"]), true);

	const loading = routingStateReducer(initial, {
		type: "detailsStarted",
		keys: ["accounts", "models"],
	});
	assert.equal(
		shouldLoadRoutingDetails(loading, ["accounts", "models"]),
		false,
	);

	const failed = routingStateReducer(loading, {
		type: "detailsFailed",
		keys: ["accounts", "models"],
		error: safeError,
	});
	assert.equal(shouldLoadRoutingDetails(failed, ["accounts", "models"]), false);

	const retryable = routingStateReducer(failed, {
		type: "detailsReset",
		keys: ["accounts", "models"],
	});
	assert.equal(
		shouldLoadRoutingDetails(retryable, ["accounts", "models"]),
		true,
	);
});

test("request generations reject stale aggregate and pre-mutation detail responses", () => {
	const coordinator = createRoutingRequestCoordinator();
	const firstAggregate = coordinator.startAggregate();
	const currentAggregate = coordinator.startAggregate();
	assert.equal(coordinator.isCurrentAggregate(firstAggregate), false);
	assert.equal(coordinator.isCurrentAggregate(currentAggregate), true);

	const detailBeforeMutation = coordinator.startDetail();
	coordinator.invalidateReads();
	assert.equal(coordinator.isCurrentDetail(detailBeforeMutation), false);
	assert.equal(coordinator.isCurrentAggregate(currentAggregate), false);
});

test("detail loads merge data without discarding details loaded by another section", () => {
	const initial = createInitialRoutingState();
	const accountsLoaded = routingStateReducer(initial, {
		type: "detailsSucceeded",
		keys: ["accounts"],
		settings: {
			...emptyRoutingSettingsView(),
			accounts: [
				{
					id: "account-1",
					provider: "anthropic",
					name: "Primary",
					authType: "api_key",
					priority: 1,
					active: true,
					status: "healthy",
					lastError: null,
					expiresAt: null,
				},
			],
		},
	});
	const modelsLoaded = routingStateReducer(accountsLoaded, {
		type: "detailsSucceeded",
		keys: ["models"],
		settings: {
			...emptyRoutingSettingsView(),
			models: [{ id: "model-a", provider: "anthropic", name: "model-a" }],
		},
	});

	assert.equal(modelsLoaded.settings.accounts?.[0]?.id, "account-1");
	assert.equal(modelsLoaded.settings.models?.[0]?.id, "model-a");

	const cleared = routingStateReducer(modelsLoaded, { type: "detailsCleared" });
	assert.equal(cleared.settings.accounts, undefined);
	assert.deepEqual(cleared.detailStatus, {});
});

test("a late aggregate response cannot discard details that completed first", () => {
	const initial = createInitialRoutingState();
	const withAccounts = routingStateReducer(initial, {
		type: "detailsSucceeded",
		keys: ["accounts"],
		settings: {
			...emptyRoutingSettingsView(),
			accounts: [
				{
					id: "account-new",
					provider: "anthropic",
					name: "Newest",
					authType: "api_key",
					priority: null,
					active: true,
					status: "healthy",
					lastError: null,
					expiresAt: null,
				},
			],
		},
	});
	const afterLateAggregate = routingStateReducer(withAccounts, {
		type: "loadSucceeded",
		settings: {
			...emptyRoutingSettingsView(),
		},
	});

	assert.equal(afterLateAggregate.settings.accounts?.[0]?.id, "account-new");
	assert.equal(afterLateAggregate.detailStatus.accounts, "loaded");
});

test("mutation state disables only the active operation and stores safe errors", () => {
	const initial = createInitialRoutingState();
	const running = routingStateReducer(initial, {
		type: "mutationStarted",
		key: "connection:save",
	});
	assert.equal(running.activeMutation, "connection:save");
	assert.notEqual(running.activeMutation, "binding:claude");

	const failed = routingStateReducer(running, {
		type: "mutationFailed",
		error: safeError,
	});
	assert.equal(failed.activeMutation, null);
	assert.deepEqual(failed.error, safeError);
	assert.equal(failed.errorContext, "mutation");
});

test("Codex application success is cleared on retry and set only after success", () => {
	const initial = createInitialRoutingState();
	const running = routingStateReducer(initial, {
		type: "mutationStarted",
		key: "codex:apply",
	});
	assert.equal(running.codexApplied, false);

	const succeeded = routingStateReducer(running, {
		type: "mutationSucceeded",
		key: "codex:apply",
	});
	assert.equal(succeeded.codexApplied, true);

	const retrying = routingStateReducer(succeeded, {
		type: "mutationStarted",
		key: "codex:apply",
	});
	assert.equal(retrying.codexApplied, false);
	const failed = routingStateReducer(retrying, {
		type: "mutationFailed",
		error: safeError,
	});
	assert.equal(failed.codexApplied, false);
});

test("detail failures are identified separately so one inline retry state owns the error", () => {
	const failed = routingStateReducer(createInitialRoutingState(), {
		type: "detailsFailed",
		keys: ["accounts", "models"],
		error: safeError,
	});

	assert.equal(failed.errorContext, "details");
	assert.equal(failed.detailStatus.accounts, "error");
	assert.equal(failed.detailStatus.models, "error");

	const mutationStarted = routingStateReducer(failed, {
		type: "mutationStarted",
		key: "account:create",
	});
	assert.equal(mutationStarted.errorContext, null);
});

test("account and model loading share the upstream details gate", () => {
	assert.deepEqual(upstreamDetailsState({ models: "loading" }), {
		loading: true,
		error: false,
	});
	assert.deepEqual(upstreamDetailsState({ accounts: "error" }), {
		loading: false,
		error: true,
	});
});

test("post-mutation refresh failures keep stale details behind a retryable error gate", () => {
	const running = routingStateReducer(createInitialRoutingState(), {
		type: "mutationStarted",
		key: "account:update:account-1",
	});
	const failed = routingStateReducer(running, {
		type: "mutationRefreshFailed",
		keys: ["accounts", "models"],
		error: safeError,
	});

	assert.equal(failed.activeMutation, null);
	assert.equal(failed.errorContext, "details");
	assert.equal(failed.detailStatus.accounts, "error");
	assert.equal(failed.detailStatus.models, "error");
});
