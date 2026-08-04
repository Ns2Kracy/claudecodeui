import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { AppError } from '@/shared/utils.js';

const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

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

function decodeMasterKey(encodedKey: string | undefined): Buffer | null {
  if (!encodedKey || encodedKey.trim() !== encodedKey) {
    return null;
  }

  try {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
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
 * Used by routing module assembly and tests to create an AES-256-GCM store from
 * the deployment-owned base64 master key. Invalid configuration fails closed.
 */
export function createRoutingSecretStore(
  encodedKey = process.env.CLOUDCLI_ROUTING_SECRET_KEY,
): RoutingSecretStore {
  const key = decodeMasterKey(encodedKey);
  if (!key) {
    return unavailableSecretStore();
  }

  return {
    available: true,

    seal(userId: number, purpose: RoutingSecretPurpose, value: string): string {
      try {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
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
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(additionalAuthenticatedData(userId, purpose));
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw decryptionFailed();
      }
    },
  };
}
