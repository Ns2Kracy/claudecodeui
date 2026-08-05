import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverSource = readFileSync(path.join(process.cwd(), 'server/index.ts'), 'utf8');

test('server startup awaits database before embedded 9router and gates usage monitor on readiness', () => {
  const dbStart = serverSource.indexOf('await initializeDatabase()');
  const embeddedStart = serverSource.indexOf('await startEmbeddedNineRouter()');
  const monitorStart = serverSource.indexOf("if (embeddedNineRouterStatus?.state === 'ready')");
  const legacyAutoConnect = serverSource.indexOf('tryAutoConnect');

  assert.ok(dbStart > 0, 'database initialization is awaited');
  assert.ok(embeddedStart > dbStart, 'embedded 9router starts after database initialization');
  assert.ok(monitorStart > embeddedStart, 'usage monitor is gated after embedded startup status');
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
