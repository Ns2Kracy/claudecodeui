import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverSource = readFileSync(path.join(process.cwd(), 'server/index.ts'), 'utf8');
const routingModuleSource = readFileSync(path.join(process.cwd(), 'server/modules/routing/routing.module.ts'), 'utf8');

test('9router client uses the configured sidecar origin without loopback-only child-process policy', () => {
  const clientFactory = routingModuleSource.indexOf('const clientFactory');
  const requestCall = routingModuleSource.indexOf('request: (input) => requestNineRouterJson(input)', clientFactory);
  const loopbackPolicy = routingModuleSource.indexOf('allowLoopbackHttp: true', clientFactory);
  const fixedHost = routingModuleSource.indexOf("allowedHosts: ['127.0.0.1']", clientFactory);
  const serviceFactory = routingModuleSource.indexOf('function routingServiceClientForRuntime', clientFactory);

  assert.ok(clientFactory >= 0);
  assert.ok(requestCall > clientFactory && requestCall < serviceFactory);
  assert.equal(loopbackPolicy, -1, 'remote sidecar client does not hard-code loopback policy');
  assert.equal(fixedHost, -1, 'remote sidecar client does not hard-code fixed host');
});

test('routing module no longer imports child-process, net, filesystem, or package resolution runtime ownership', () => {
  assert.equal(routingModuleSource.includes("node:child_process"), false);
  assert.equal(routingModuleSource.includes("node:net"), false);
  assert.equal(routingModuleSource.includes("node:fs"), false);
  assert.equal(routingModuleSource.includes('createRequire'), false);
  assert.equal(routingModuleSource.includes('require.resolve'), false);
});

test('server startup awaits database before sidecar health refresh and leaves usage monitor control to runtime status changes', () => {
  const dbStart = serverSource.indexOf('await initializeDatabase()');
  const sidecarRefresh = serverSource.indexOf('await refreshNineRouterSidecar()');
  const monitorStart = serverSource.indexOf('startRoutingUsageMonitor');
  const legacyAutoConnect = serverSource.indexOf('tryAutoConnect');

  assert.ok(dbStart > 0, 'database initialization is awaited');
  assert.ok(sidecarRefresh > dbStart, 'sidecar health refresh runs after database initialization');
  assert.equal(monitorStart, -1, 'startup does not duplicate runtime usage monitor gating');
  assert.equal(legacyAutoConnect, -1, 'legacy auto-connect is not called during startup');
});

test('server startup keeps CloudCLI alive when sidecar is unavailable', () => {
  const sidecarRefresh = serverSource.indexOf('await refreshNineRouterSidecar().catch');
  const listen = serverSource.indexOf('server.listen(SERVER_PORT');

  assert.ok(sidecarRefresh > 0, 'sidecar refresh failure is caught locally');
  assert.ok(listen > sidecarRefresh, 'server listen remains after nonfatal sidecar handling');
});

test('server shutdown does not stop or signal Compose-owned 9router', () => {
  const shutdown = serverSource.indexOf('const shutdownRuntimeServices = async () => {');
  const stopSidecar = serverSource.indexOf('stopEmbeddedNineRouter', shutdown);
  const refreshSidecar = serverSource.indexOf('refreshNineRouterSidecar', shutdown);
  const processExit = serverSource.indexOf('process.exit(0)', shutdown);

  assert.ok(shutdown > 0, 'shutdown routine exists');
  assert.equal(stopSidecar, -1, 'CloudCLI shutdown does not stop sidecar process');
  assert.equal(refreshSidecar, -1, 'CloudCLI shutdown does not signal sidecar');
  assert.ok(processExit > shutdown, 'process exits after local cleanup');
});
