import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createRoutingSecretStore } from '../routing-secret-store.js';

const validKey = Buffer.alloc(32, 7).toString('base64');

function assertAppError(
  run: () => unknown,
  code: string,
  statusCode: number,
  forbiddenText?: string,
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    if (forbiddenText) {
      assert.equal(error.message.includes(forbiddenText), false);
    }
    return true;
  });
}

test('requires an exact 32-byte canonical base64 master key', () => {
  assert.equal(createRoutingSecretStore(validKey).available, true);
  assert.equal(createRoutingSecretStore(undefined).available, false);
  assert.equal(createRoutingSecretStore('').available, false);
  assert.equal(createRoutingSecretStore('not-base64').available, false);
  assert.equal(createRoutingSecretStore(Buffer.alloc(31).toString('base64')).available, false);
  assert.equal(createRoutingSecretStore(Buffer.alloc(33).toString('base64')).available, false);
});

test('unavailable secure storage fails closed without exposing plaintext', () => {
  const store = createRoutingSecretStore(undefined);
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
  const store = createRoutingSecretStore(validKey);
  const first = store.seal(7, 'data-plane-key', 'sk-secret');
  const second = store.seal(7, 'data-plane-key', 'sk-secret');

  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(first.includes('sk-secret'), false);
  assert.equal(store.open(7, 'data-plane-key', first), 'sk-secret');
});

test('matching user and purpose are required to decrypt an envelope', () => {
  const store = createRoutingSecretStore(validKey);
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
  const store = createRoutingSecretStore(validKey);
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
