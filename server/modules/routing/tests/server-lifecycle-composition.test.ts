import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const serverSource = readFileSync(
	path.join(process.cwd(), "server/index.ts"),
	"utf8",
);
const routingModuleSource = readFileSync(
	path.join(process.cwd(), "server/modules/routing/routing.module.ts"),
	"utf8",
);

test("9router client uses the configured sidecar origin without loopback-only child-process policy", () => {
	const clientFactory = routingModuleSource.indexOf("const clientFactory");
	const requestCall = routingModuleSource.indexOf(
		"request: (input) => requestConfiguredSidecar(input)",
		clientFactory,
	);
	const loopbackPolicy = routingModuleSource.indexOf(
		"allowLoopbackHttp: true",
		clientFactory,
	);
	const fixedHost = routingModuleSource.indexOf(
		"allowedHosts: ['127.0.0.1']",
		clientFactory,
	);
	const serviceFactory = routingModuleSource.indexOf(
		"function routingServiceClientForRuntime",
		clientFactory,
	);

	assert.ok(clientFactory >= 0);
	assert.ok(requestCall > clientFactory && requestCall < serviceFactory);
	assert.equal(
		loopbackPolicy,
		-1,
		"remote sidecar client does not hard-code loopback policy",
	);
	assert.equal(
		fixedHost,
		-1,
		"remote sidecar client does not hard-code fixed host",
	);
});

test("routing module no longer imports child-process, net, filesystem, or package resolution runtime ownership", () => {
	assert.equal(routingModuleSource.includes("node:child_process"), false);
	assert.equal(routingModuleSource.includes("node:net"), false);
	assert.equal(routingModuleSource.includes("node:fs"), false);
	assert.equal(routingModuleSource.includes("createRequire"), false);
	assert.equal(routingModuleSource.includes("require.resolve"), false);
});

test("server startup initializes the Router key after database setup without health probes", () => {
	const dbStart = serverSource.indexOf("await initializeDatabase()");
	const keyInitialization = serverSource.indexOf(
		"await initializeNineRouterDataPlaneKey()",
	);
	const monitorStart = serverSource.indexOf("startRoutingUsageMonitor");
	const legacyAutoConnect = serverSource.indexOf("tryAutoConnect");

	assert.ok(dbStart > 0, "database initialization is awaited");
	assert.ok(
		keyInitialization > dbStart,
		"key initialization runs after database initialization",
	);
	assert.equal(serverSource.includes("/api/health"), false);
	assert.equal(serverSource.includes("/api/version"), false);
	assert.equal(
		monitorStart,
		-1,
		"startup does not duplicate runtime usage monitor gating",
	);
	assert.equal(
		legacyAutoConnect,
		-1,
		"legacy auto-connect is not called during startup",
	);
});

test("server startup keeps CloudCLI alive when Router key initialization fails", () => {
	const keyInitialization = serverSource.indexOf(
		"await initializeNineRouterDataPlaneKey().catch",
	);
	const listen = serverSource.indexOf("server.listen(SERVER_PORT");

	assert.ok(
		keyInitialization > 0,
		"key initialization failure is caught locally",
	);
	assert.ok(
		listen > keyInitialization,
		"server listen remains after nonfatal Router handling",
	);
});

test("server shutdown does not stop or signal Compose-owned 9router", () => {
	const shutdown = serverSource.indexOf(
		"const shutdownRuntimeServices = async () => {",
	);
	const stopSidecar = serverSource.indexOf("stopEmbeddedNineRouter", shutdown);
	const initializeRouter = serverSource.indexOf(
		"initializeNineRouterDataPlaneKey",
		shutdown,
	);
	const processExit = serverSource.indexOf("process.exit(0)", shutdown);

	assert.ok(shutdown > 0, "shutdown routine exists");
	assert.equal(
		stopSidecar,
		-1,
		"CloudCLI shutdown does not stop sidecar process",
	);
	assert.equal(
		initializeRouter,
		-1,
		"CloudCLI shutdown does not call Router initialization",
	);
	assert.ok(processExit > shutdown, "process exits after local cleanup");
});
