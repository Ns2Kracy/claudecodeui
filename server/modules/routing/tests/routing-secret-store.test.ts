import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createRoutingSecretStore, resolveMasterKey } from '../routing-secret-store.js';

const validBase64Key = Buffer.alloc(32, 7).toString('base64');
const passphraseSalt = Buffer.from('cloudcli-routing-master-key-v1', 'utf8');
const derivedKey = pbkdf2Sync('my-deployment-passphrase', passphraseSalt, 100_000, 32, 'sha256');

function assertAppError(
  run: () => unknown,
  code: string,
  statusCode: number,
  forbiddenText?: string,
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).code, code);
    assert.equal((error as AppError).statusCode, statusCode);
    if (forbiddenText) {
      assert.equal((error as AppError).message.includes(forbiddenText), false);
    }
    return true;
  });
}

test('accepts an exact 32-byte canonical base64 master key', () => {
  assert.equal(createRoutingSecretStore(Buffer.from(validBase64Key, 'base64')).available, true);
  assert.equal(createRoutingSecretStore(null).available, false);
});

test('accepts a passphrase and derives a stable 32-byte key via PBKDF2', () => {
  const store = createRoutingSecretStore(derivedKey);
  assert.equal(store.available, true);

  const sealed = store.seal(1, 'admin-password', 'secret-from-passphrase');
  assert.equal(store.open(1, 'admin-password', sealed), 'secret-from-passphrase');
});

test('resolveMasterKey parses base64 keys from the environment', () => {
  const previousKey = process.env.ROUTING_SECRET_KEY;
  const previousFile = process.env.ROUTING_SECRET_KEY_FILE;
  try {
    process.env.ROUTING_SECRET_KEY = validBase64Key;
    delete process.env.ROUTING_SECRET_KEY_FILE;
    const key = resolveMasterKey();
    assert.ok(key);
    assert.equal(key.length, 32);
    assert.deepEqual(key, Buffer.from(validBase64Key, 'base64'));
  } finally {
    if (previousKey === undefined) delete process.env.ROUTING_SECRET_KEY;
    else process.env.ROUTING_SECRET_KEY = previousKey;
    if (previousFile === undefined) delete process.env.ROUTING_SECRET_KEY_FILE;
    else process.env.ROUTING_SECRET_KEY_FILE = previousFile;
  }
});

test('resolveMasterKey derives a passphrase when the value is not valid base64', () => {
  const previousKey = process.env.ROUTING_SECRET_KEY;
  const previousFile = process.env.ROUTING_SECRET_KEY_FILE;
  try {
    process.env.ROUTING_SECRET_KEY = 'my-deployment-passphrase';
    delete process.env.ROUTING_SECRET_KEY_FILE;
    const key = resolveMasterKey();
    assert.ok(key);
    assert.equal(key.length, 32);
    assert.deepEqual(key, derivedKey);
  } finally {
    if (previousKey === undefined) delete process.env.ROUTING_SECRET_KEY;
    else process.env.ROUTING_SECRET_KEY = previousKey;
    if (previousFile === undefined) delete process.env.ROUTING_SECRET_KEY_FILE;
    else process.env.ROUTING_SECRET_KEY_FILE = previousFile;
  }
});

test('resolveMasterKey prefers _FILE over the inline env var', () => {
  const previousKey = process.env.ROUTING_SECRET_KEY;
  const previousFile = process.env.ROUTING_SECRET_KEY_FILE;
  const dir = mkdtempSync(join(tmpdir(), 'routing-key-test-'));
  const filePath = join(dir, 'secret-key');
  try {
    writeFileSync(filePath, 'my-deployment-passphrase\n', 'utf8');
    process.env.ROUTING_SECRET_KEY_FILE = filePath;
    process.env.ROUTING_SECRET_KEY = 'different-ignored-value';
    const key = resolveMasterKey();
    assert.ok(key);
    assert.deepEqual(key, derivedKey);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.ROUTING_SECRET_KEY;
    else process.env.ROUTING_SECRET_KEY = previousKey;
    if (previousFile === undefined) delete process.env.ROUTING_SECRET_KEY_FILE;
    else process.env.ROUTING_SECRET_KEY_FILE = previousFile;
  }
});

test('resolveMasterKey returns null when neither env var is set', () => {
  const previousKey = process.env.ROUTING_SECRET_KEY;
  const previousFile = process.env.ROUTING_SECRET_KEY_FILE;
  try {
    delete process.env.ROUTING_SECRET_KEY;
    delete process.env.ROUTING_SECRET_KEY_FILE;
    assert.equal(resolveMasterKey(), null);
  } finally {
    if (previousKey === undefined) delete process.env.ROUTING_SECRET_KEY;
    else process.env.ROUTING_SECRET_KEY = previousKey;
    if (previousFile === undefined) delete process.env.ROUTING_SECRET_KEY_FILE;
    else process.env.ROUTING_SECRET_KEY_FILE = previousFile;
  }
});

test('unavailable secure storage fails closed without exposing plaintext', () => {
  const store = createRoutingSecretStore(null);
  const plaintext = 'never-log-this-secret';

  assertAppError(
    () => store.seal(7, 'data-plane-key', plaintext),
    'ROUTING_SECURE_STORAGE_UNAVAILABLE',
    503,
    plaintext,
  );
  assertAppError(
    () => store.open(7, 'data-plane-key', `v1.${plaintext}`),
    'ROUTING_SECURE_STORAGE_UNAVAILABLE',
    503,
    plaintext,
  );
});

test('AES-GCM uses a fresh IV and restores plaintext for matching AAD', () => {
  const store = createRoutingSecretStore(Buffer.from(validBase64Key, 'base64'));
  const first = store.seal(7, 'data-plane-key', 'sk-secret');
  const second = store.seal(7, 'data-plane-key', 'sk-secret');

  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(first.includes('sk-secret'), false);
  assert.equal(store.open(7, 'data-plane-key', first), 'sk-secret');
});

test('matching user and purpose are required to decrypt an envelope', () => {
  const store = createRoutingSecretStore(Buffer.from(validBase64Key, 'base64'));
  const sealed = store.seal(7, 'data-plane-key', 'sk-cross-boundary');

  assertAppError(
    () => store.open(8, 'data-plane-key', sealed),
    'ROUTING_SECRET_DECRYPT_FAILED',
    500,
    'sk-cross-boundary',
  );
  assertAppError(
    () => store.open(7, 'admin-password', sealed),
    'ROUTING_SECRET_DECRYPT_FAILED',
    500,
    'sk-cross-boundary',
  );
});

test('tampered and malformed envelopes fail with a safe typed error', () => {
  const store = createRoutingSecretStore(Buffer.from(validBase64Key, 'base64'));
  const plaintext = 'sk-tamper-secret';
  const sealed = store.seal(7, 'data-plane-key', plaintext);
  const parts = sealed.split('.');
  const ciphertext = parts[3];
  const finalCharacter = ciphertext.at(-1) === 'A' ? 'B' : 'A';
  parts[3] = `${ciphertext.slice(0, -1)}${finalCharacter}`;

  for (const envelope of [parts.join('.'), 'v2.bad.envelope.value', 'not-an-envelope']) {
    assertAppError(
      () => store.open(7, 'data-plane-key', envelope),
      'ROUTING_SECRET_DECRYPT_FAILED',
      500,
      plaintext,
    );
  }
});
