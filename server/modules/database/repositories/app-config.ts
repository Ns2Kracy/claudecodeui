/**
 * App config repository.
 *
 * Key-value store for application-level configuration that persists
 * across restarts (JWT secret, feature flags, etc.). Values are always
 * stored as strings; callers handle parsing.
 */

import crypto from 'crypto';

import { getConnection } from '@/modules/database/connection.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const appConfigDb = {
  /** Returns the stored value for a config key, or null if missing. */
  get(key: string): string | null {
    try {
      const db = getConnection();
      const row = db
        .prepare('SELECT value FROM app_config WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    } catch {
      // Swallow errors so early-startup reads (e.g. JWT secret) do not crash.
      return null;
    }
  },

  /** Inserts or updates a config key (upsert). */
  set(key: string, value: string): void {
    const db = getConnection();
    db.prepare(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  },

  /**
   * Returns an application secret for a config key, generating and persisting
   * one if it does not already exist. Used by internal runtime integrations
   * that need stable installation-local hex secrets across restarts.
   */
  getOrCreateSecret(key: string, bytes = 32): string {
    if (!key.trim() || !Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) {
      throw new Error('Invalid application secret configuration');
    }

    let secret = appConfigDb.get(key);
    if (!secret) {
      secret = crypto.randomBytes(bytes).toString('hex');
      appConfigDb.set(key, secret);
    }
    return secret;
  },

  /**
   * Returns the JWT signing secret, generating and persisting one
   * if it does not already exist. This ensures the secret survives
   * server restarts while being created automatically on first boot.
   */
  getOrCreateJwtSecret(): string {
    return appConfigDb.getOrCreateSecret('jwt_secret', 64);
  },
};
