import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { routingDb } from '@/modules/database/repositories/routing.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'routing-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createUser(username: string): number {
  const result = getConnection()
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, 'test-hash');
  return Number(result.lastInsertRowid);
}

const connectionRow = {
  baseUrl: 'https://router.example',
  adminSecretCiphertext: 'v1.admin-ciphertext',
  dataPlaneKeyCiphertext: 'v1.key-ciphertext',
  upstreamVersion: '0.5.45',
  capabilities: null,
  lastCheckedAt: '2026-08-04T00:00:00.000Z',
  lastErrorCode: null,
};

test('routing connections are unique and isolated per user', async () => {
  await withIsolatedDatabase(() => {
    const firstUserId = createUser('routing-user-one');
    const secondUserId = createUser('routing-user-two');

    routingDb.upsertConnection(firstUserId, connectionRow);
    routingDb.upsertConnection(firstUserId, {
      ...connectionRow,
      baseUrl: 'https://updated-router.example',
    });
    routingDb.upsertConnection(secondUserId, connectionRow);

    assert.equal(routingDb.getConnection(firstUserId)?.baseUrl, 'https://updated-router.example');
    assert.equal(routingDb.getConnection(secondUserId)?.baseUrl, 'https://router.example');
    assert.deepEqual(routingDb.listConnectionUserIds(), [firstUserId, secondUserId]);
    assert.equal(
      (getConnection().prepare('SELECT COUNT(*) AS count FROM routing_connections').get() as {
        count: number;
      }).count,
      2,
    );
  });
});

test('routing persistence stores ciphertext without plaintext credentials', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('routing-secret-user');
    routingDb.upsertConnection(userId, connectionRow);
    routingDb.setProviderDefault(userId, 'claude', {
      source: '9router',
      routeId: 'combo-1',
      routeName: 'quality-first',
    });
    routingDb.upsertAlert(userId, {
      period: 'daily',
      thresholdMicrousd: 2_500_000,
      enabled: true,
    });

    const connection = routingDb.getConnection(userId);
    assert.equal(connection?.adminSecretCiphertext, 'v1.admin-ciphertext');
    assert.equal(connection?.dataPlaneKeyCiphertext, 'v1.key-ciphertext');

    const routingTables = ['routing_connections', 'routing_bindings', 'routing_usage_alerts'];
    const persisted = routingTables.flatMap((table) =>
      getConnection().prepare(`SELECT * FROM ${table}`).all(),
    );
    const serialized = JSON.stringify(persisted);
    assert.equal(serialized.includes('admin-plaintext'), false);
    assert.equal(serialized.includes('data-plane-plaintext'), false);
  });
});

test('provider defaults are isolated by user', async () => {
  await withIsolatedDatabase(() => {
    const firstUserId = createUser('routing-default-one');
    const secondUserId = createUser('routing-default-two');

    routingDb.setProviderDefault(firstUserId, 'claude', {
      source: '9router',
      routeId: 'combo-1',
      routeName: 'quality-first',
    });
    routingDb.setProviderDefault(secondUserId, 'claude', { source: 'native' });

    assert.equal(routingDb.getProviderDefault(firstUserId, 'claude')?.source, '9router');
    assert.equal(routingDb.getProviderDefault(secondUserId, 'claude')?.source, 'native');
    assert.equal(routingDb.getProviderDefault(secondUserId, 'codex'), null);
  });
});

test('session snapshots remain sticky after provider defaults change', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('routing-session-user');

    routingDb.setProviderDefault(userId, 'claude', {
      source: '9router',
      routeId: 'combo-1',
      routeName: 'quality-first',
    });
    routingDb.snapshotSessionBinding(userId, 'session-1', 'claude');
    routingDb.setProviderDefault(userId, 'claude', { source: 'native' });

    assert.equal(routingDb.getSessionBinding(userId, 'session-1')?.source, '9router');
    assert.equal(routingDb.getProviderDefault(userId, 'claude')?.source, 'native');
  });
});

test('deleting a connection explicitly removes its settings only', async () => {
  await withIsolatedDatabase(() => {
    const firstUserId = createUser('routing-delete-one');
    const secondUserId = createUser('routing-delete-two');

    for (const userId of [firstUserId, secondUserId]) {
      routingDb.upsertConnection(userId, connectionRow);
      routingDb.setProviderDefault(userId, 'codex', {
        source: '9router',
        routeId: 'combo-1',
        routeName: 'quality-first',
      });
      routingDb.upsertAlert(userId, {
        period: '30d',
        thresholdMicrousd: 5_000_000,
        enabled: true,
      });
    }

    routingDb.deleteConnectionAndSettings(firstUserId);

    assert.equal(routingDb.getConnection(firstUserId), null);
    assert.deepEqual(routingDb.getProviderDefaults(firstUserId), []);
    assert.deepEqual(routingDb.listAlerts(firstUserId), []);
    assert.notEqual(routingDb.getConnection(secondUserId), null);
    assert.equal(routingDb.getProviderDefaults(secondUserId).length, 1);
    assert.equal(routingDb.listAlerts(secondUserId).length, 1);
  });
});

test('usage alert thresholds are non-negative integer micro-USD values', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('routing-alert-user');

    assert.throws(
      () =>
        routingDb.upsertAlert(userId, {
          period: 'daily',
          thresholdMicrousd: 1.5,
          enabled: true,
        }),
      /integer micro-USD/i,
    );
    assert.throws(
      () =>
        routingDb.upsertAlert(userId, {
          period: 'daily',
          thresholdMicrousd: -1,
          enabled: true,
        }),
      /integer micro-USD/i,
    );

    routingDb.upsertAlert(userId, {
      period: 'daily',
      thresholdMicrousd: 1_500_000,
      enabled: true,
    });
    assert.deepEqual(routingDb.listAlerts(userId), [
      {
        period: 'daily',
        thresholdMicrousd: 1_500_000,
        enabled: true,
        lastNotifiedPeriodKey: null,
      },
    ]);
  });
});
