import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverSource = readFileSync(path.join(process.cwd(), 'server/index.ts'), 'utf8');
const routingModuleSource = readFileSync(path.join(process.cwd(), 'server/modules/routing/routing.module.ts'), 'utf8');

test('embedded 9router client explicitly admits only its fixed loopback management target', () => {
  const clientFactory = routingModuleSource.indexOf('const clientFactory');
  const loopbackPolicy = routingModuleSource.indexOf('allowLoopbackHttp: true', clientFactory);
  const fixedHost = routingModuleSource.indexOf("allowedHosts: ['127.0.0.1']", clientFactory);
  const serviceFactory = routingModuleSource.indexOf('function routingServiceClientForRuntime', clientFactory);

  assert.ok(clientFactory >= 0);
  assert.ok(loopbackPolicy > clientFactory && loopbackPolicy < serviceFactory);
  assert.ok(fixedHost > loopbackPolicy && fixedHost < serviceFactory);
});

test('server startup awaits database before embedded 9router and leaves usage monitor control to runtime status changes', () => {
  const dbStart = serverSource.indexOf('await initializeDatabase()');
  const embeddedStart = serverSource.indexOf('await startEmbeddedNineRouter()');
  const monitorStart = serverSource.indexOf('startRoutingUsageMonitor');
  const legacyAutoConnect = serverSource.indexOf('tryAutoConnect');

  assert.ok(dbStart > 0, 'database initialization is awaited');
  assert.ok(embeddedStart > dbStart, 'embedded 9router starts after database initialization');
  assert.equal(monitorStart, -1, 'startup does not duplicate runtime usage monitor gating');
  assert.equal(legacyAutoConnect, -1, 'legacy auto-connect is not called during startup');
});

test('server startup keeps CloudCLI alive when embedded 9router is unavailable', () => {
  const embeddedStart = serverSource.indexOf('await startEmbeddedNineRouter().catch');
  const listen = serverSource.indexOf('server.listen(SERVER_PORT');

  assert.ok(embeddedStart > 0, 'embedded startup failure is caught locally');
  assert.ok(listen > embeddedStart, 'server listen remains after nonfatal embedded startup handling');
});

test('server shutdown stops monitor and awaits embedded child before process exit', () => {
  const shutdown = serverSource.indexOf('const shutdownRuntimeServices = async () => {');
  const stopMonitor = serverSource.indexOf('stopRoutingUsageMonitor()', shutdown);
  const stopEmbedded = serverSource.indexOf('await stopEmbeddedNineRouter()', shutdown);
  const processExit = serverSource.indexOf('process.exit(0)', shutdown);

  assert.ok(shutdown > 0, 'shutdown routine exists');
  assert.ok(stopMonitor > shutdown, 'usage monitor is stopped during shutdown');
  assert.ok(stopEmbedded > stopMonitor, 'embedded child is awaited after monitor stop');
  assert.ok(processExit > stopEmbedded, 'process exits only after embedded stop is awaited');
});
