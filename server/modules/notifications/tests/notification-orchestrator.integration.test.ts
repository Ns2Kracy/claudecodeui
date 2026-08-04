import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';

import {
  buildNotificationPayload,
  createNotificationEvent,
  notifyUserIfEnabled,
} from '../services/notification-orchestrator.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'notification-orchestrator-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');

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
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('notification payload uses the app session id for a provider session id', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');

    const payload = buildNotificationPayload(createNotificationEvent({
      provider: 'claude',
      sessionId: 'claude-native-1',
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason: 'completed' },
    }));

    assert.equal(payload.data.sessionId, 'app-session-1');
    assert.match(payload.data.tag, /app-session-1/);
  });
});

test('notification delivery reports false when every deliverable channel is disabled', async () => {
  await withIsolatedDatabase(() => {
    const user = userDb.createUser('notification-disabled-user', 'hash');
    const accepted = notifyUserIfEnabled({
      userId: Number(user.id),
      event: createNotificationEvent({
        provider: 'system',
        code: 'agent.notification',
        meta: { message: 'Safe advisory message' },
      }),
    });

    assert.equal(accepted, false);
  });
});

test('explicit notification dedupe keys use a rolling suppression window', async () => {
  await withIsolatedDatabase(() => {
    const user = userDb.createUser('notification-dedupe-user', 'hash');
    notificationPreferencesDb.updatePreferences(Number(user.id), {
      channels: { desktop: true },
      events: {},
    });
    const event = createNotificationEvent({
      provider: 'system',
      code: 'agent.notification',
      meta: { message: 'Safe advisory message' },
      dedupeKey: `notification-dedupe-test:${user.id}`,
    });
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;

    try {
      assert.equal(notifyUserIfEnabled({ userId: Number(user.id), event }), true);
      now = 11_000;
      assert.equal(notifyUserIfEnabled({ userId: Number(user.id), event }), false);
      now = 25_000;
      assert.equal(notifyUserIfEnabled({ userId: Number(user.id), event }), false);
      now = 46_000;
      assert.equal(notifyUserIfEnabled({ userId: Number(user.id), event }), true);
    } finally {
      Date.now = originalNow;
    }
  });
});
