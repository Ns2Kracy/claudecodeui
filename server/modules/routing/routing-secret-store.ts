import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { AppError } from '@/shared/utils.js';

const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_SALT = Buffer.from('cloudcli-routing-master-key-v1', 'utf8');

/** Used by the routing service to bind encrypted values to their intended credential role. */
export type RoutingSecretPurpose = 'admin-password' | 'data-plane-key';

/** Used by routing workflows to encrypt credentials before persistence and decrypt them only at use. */
export type RoutingSecretStore = {
  available: boolean;
  seal(userId: number, purpose: RoutingSecretPurpose, value: string): string;
  open(userId: number, purpose: RoutingSecretPurpose, envelope: string): string;
};

function secureStorageUnavailable(): AppError {
  return new AppError('Secure routing credential storage is unavailable', {
    code: 'ROUTING_SECURE_STORAGE_UNAVAILABLE',
    statusCode: 503,
  });
}

function encryptionFailed(): AppError {
  return new AppError('Routing credential encryption failed', {
    code: 'ROUTING_SECRET_ENCRYPT_FAILED',
    statusCode: 500,
  });
}

function decryptionFailed(): AppError {
  return new AppError('Routing credential decryption failed', {
    code: 'ROUTING_SECRET_DECRYPT_FAILED',
    statusCode: 500,
  });
}

function isValidBase64Key(value: string): boolean {
  try {
    const key = Buffer.from(value, 'base64');
    return key.length === MASTER_KEY_BYTES && key.toString('base64') === value;
  } catch {
    return false;
  }
}

function deriveKeyFromPassphrase(passphrase: string): Buffer {
  return pbkdf2Sync(passphrase, PBKDF2_SALT, PBKDF2_ITERATIONS, MASTER_KEY_BYTES, PBKDF2_DIGEST);
}

/**
 * Resolves the master key from environment variables. The lookup order is:
 *
 * 1. `CLOUDCLI_ROUTING_SECRET_KEY_FILE` — path to a file containing the key material
 * 2. `CLOUDCLI_ROUTING_SECRET_KEY` — the key material directly
 *
 * In both cases the material is interpreted as:
 * - A canonical 32-byte base64 key (existing exact-match behaviour), or
 * - A passphrase that is derived into a 32-byte key with PBKDF2.
 */
export function resolveMasterKey(): Buffer | null {
  const filePath = process.env.CLOUDCLI_ROUTING_SECRET_KEY_FILE?.trim();
  let rawValue: string | undefined;

  if (filePath) {
    try {
      rawValue = readFileSync(filePath, 'utf8').trim();
    } catch {
      console.warn('[Routing] Failed to read secret key file', { path: filePath });
      return null;
    }
  }

  if (!rawValue) {
    rawValue = process.env.CLOUDCLI_ROUTING_SECRET_KEY?.trim();
  }

  if (!rawValue) {
    return null;
  }

  if (isValidBase64Key(rawValue)) {
    return Buffer.from(rawValue, 'base64');
  }

  return deriveKeyFromPassphrase(rawValue);
}

function additionalAuthenticatedData(userId: number, purpose: RoutingSecretPurpose): Buffer {
  return Buffer.from(`cloudcli:routing:${userId}:${purpose}`, 'utf8');
}

function decodeBase64UrlPart(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw decryptionFailed();
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw decryptionFailed();
  }
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw decryptionFailed();
  }
  return decoded;
}

function unavailableSecretStore(): RoutingSecretStore {
  return {
    available: false,
    seal(): never {
      throw secureStorageUnavailable();
    },
    open(): never {
      throw secureStorageUnavailable();
    },
  };
}

/**
 * Used by routing module assembly and tests to create an AES-256-GCM store.
 * Accepts an explicit key for testing; resolves from the environment when omitted.
 * Invalid configuration fails closed.
 */
export function createRoutingSecretStore(key?: Buffer | null): RoutingSecretStore {
  const masterKey = key !== undefined ? key : resolveMasterKey();
  if (!masterKey) {
    return unavailableSecretStore();
  }

  return {
    available: true,

    seal(userId: number, purpose: RoutingSecretPurpose, value: string): string {
      try {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
        cipher.setAAD(additionalAuthenticatedData(userId, purpose));
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return [
          ENVELOPE_VERSION,
          iv.toString('base64url'),
          authTag.toString('base64url'),
          ciphertext.toString('base64url'),
        ].join('.');
      } catch {
        throw encryptionFailed();
      }
    },

    open(userId: number, purpose: RoutingSecretPurpose, envelope: string): string {
      try {
        const parts = envelope.split('.');
        if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
          throw decryptionFailed();
        }

        const iv = decodeBase64UrlPart(parts[1], IV_BYTES);
        const authTag = decodeBase64UrlPart(parts[2], AUTH_TAG_BYTES);
        const ciphertext = decodeBase64UrlPart(parts[3]);
        const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
        decipher.setAAD(additionalAuthenticatedData(userId, purpose));
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw decryptionFailed();
      }
    },
  };
}
