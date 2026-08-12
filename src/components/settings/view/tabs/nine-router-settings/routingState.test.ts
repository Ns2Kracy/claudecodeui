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

	const settings = {
		...emptyRoutingSettingsView(),
		routeSummary: { total: 3 },
	};
	const loaded = routingStateReducer(initial, {
		type: "loadSucceeded",
		settings,
	});
	assert.equal(loaded.loading, false);
	assert.equal(loaded.settings.routeSummary.total, 3);
	assert.equal(loaded.error, null);
});

test("expanded detail sections trigger one read until explicitly retried", () => {
	const initial = createInitialRoutingState();
	assert.equal(shouldLoadRoutingDetails(initial, ["accounts", "routes"]), true);

	const loading = routingStateReducer(initial, {
		type: "detailsStarted",
		keys: ["accounts", "routes"],
	});
	assert.equal(
		shouldLoadRoutingDetails(loading, ["accounts", "routes"]),
		false,
	);

	const failed = routingStateReducer(loading, {
		type: "detailsFailed",
		keys: ["accounts", "routes"],
		error: safeError,
	});
	assert.equal(shouldLoadRoutingDetails(failed, ["accounts", "routes"]), false);

	const retryable = routingStateReducer(failed, {
		type: "detailsReset",
		keys: ["accounts", "routes"],
	});
	assert.equal(
		shouldLoadRoutingDetails(retryable, ["accounts", "routes"]),
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
	const routesLoaded = routingStateReducer(accountsLoaded, {
		type: "detailsSucceeded",
		keys: ["routes"],
		settings: {
			...emptyRoutingSettingsView(),
			routes: [
				{
					id: "route-1",
					name: "quality-first",
					kind: null,
					models: ["model-a"],
				},
			],
		},
	});

	assert.equal(routesLoaded.settings.accounts?.[0]?.id, "account-1");
	assert.equal(routesLoaded.settings.routes?.[0]?.id, "route-1");

	const cleared = routingStateReducer(routesLoaded, { type: "detailsCleared" });
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
			routeSummary: { total: 2 },
		},
	});

	assert.equal(afterLateAggregate.settings.accounts?.[0]?.id, "account-new");
	assert.equal(afterLateAggregate.settings.routeSummary.total, 2);
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

test("route-only loading and failures keep the upstream route editor gated", () => {
	assert.deepEqual(upstreamDetailsState({ routes: "loading" }), {
		loading: true,
		error: false,
	});
	assert.deepEqual(upstreamDetailsState({ routes: "error" }), {
		loading: false,
		error: true,
	});
});

test("post-mutation refresh failures keep stale details behind a retryable error gate", () => {
	const running = routingStateReducer(createInitialRoutingState(), {
		type: "mutationStarted",
		key: "route:update:route-1",
	});
	const failed = routingStateReducer(running, {
		type: "mutationRefreshFailed",
		keys: ["accounts", "models", "routes"],
		error: safeError,
	});

	assert.equal(failed.activeMutation, null);
	assert.equal(failed.errorContext, "details");
	assert.equal(failed.detailStatus.accounts, "error");
	assert.equal(failed.detailStatus.models, "error");
	assert.equal(failed.detailStatus.routes, "error");
});
