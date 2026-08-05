import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { appConfigDb } from '@/modules/database/repositories/app-config.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'app-config-db-'));
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

test('appConfigDb.getOrCreateSecret returns and persists a hex secret with the requested byte length', async () => {
  await withIsolatedDatabase(() => {
    const secret = appConfigDb.getOrCreateSecret('nine_router_api_key_secret', 24);
    const repeated = appConfigDb.getOrCreateSecret('nine_router_api_key_secret', 24);

    assert.match(secret, /^[0-9a-f]+$/);
    assert.equal(secret.length, 48);
    assert.equal(repeated, secret);
  });
});

test('appConfigDb.getOrCreateSecret defaults to a 32-byte secret', async () => {
  await withIsolatedDatabase(() => {
    const secret = appConfigDb.getOrCreateSecret('nine_router_machine_id_salt');

    assert.match(secret, /^[0-9a-f]+$/);
    assert.equal(secret.length, 64);
  });
});

test('appConfigDb.getOrCreateSecret creates different secrets for different keys', async () => {
  await withIsolatedDatabase(() => {
    const first = appConfigDb.getOrCreateSecret('nine_router_initial_password', 32);
    const second = appConfigDb.getOrCreateSecret('nine_router_jwt_secret', 32);

    assert.notEqual(first, second);
  });
});

test('appConfigDb.getOrCreateSecret rejects blank keys and unsafe byte counts', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(() => appConfigDb.getOrCreateSecret('', 32), /Invalid application secret configuration/);
    assert.throws(() => appConfigDb.getOrCreateSecret('   ', 32), /Invalid application secret configuration/);
    assert.throws(() => appConfigDb.getOrCreateSecret('too_short', 15), /Invalid application secret configuration/);
    assert.throws(() => appConfigDb.getOrCreateSecret('too_long', 129), /Invalid application secret configuration/);
    assert.throws(() => appConfigDb.getOrCreateSecret('not_safe', Number.MAX_SAFE_INTEGER + 1), /Invalid application secret configuration/);
  });
});

test('appConfigDb.getOrCreateJwtSecret preserves its 64-byte hex secret behavior', async () => {
  await withIsolatedDatabase(() => {
    const secret = appConfigDb.getOrCreateJwtSecret();
    const repeated = appConfigDb.getOrCreateJwtSecret();

    assert.match(secret, /^[0-9a-f]+$/);
    assert.equal(secret.length, 128);
    assert.equal(repeated, secret);
  });
});
