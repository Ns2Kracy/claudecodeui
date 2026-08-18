import webPush from 'web-push';

import { notificationPreferencesDb, pushSubscriptionsDb, sessionsDb } from '@/modules/database/index.js';

type NotificationPreferences = ReturnType<typeof notificationPreferencesDb.getPreferences>;
type NotificationMeta = Record<string, unknown>;
type NotificationEvent = {
  provider: string;
  sessionId: string | null;
  kind: string;
  code: string;
  meta: NotificationMeta;
  severity: string;
  requiresUserAction: boolean;
  dedupeKey: string | null;
  createdAt: string;
};
type CreateNotificationEventInput = {
  provider: string;
  sessionId?: string | null;
  kind?: string;
  code?: string;
  meta?: NotificationMeta;
  severity?: string;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
};
type NotificationPayload = {
  title: string;
  body: string;
  data: {
    sessionId: string | null;
    code: string;
    provider: string | null;
    sessionName: string | null;
    tag: string;
  };
};
type NotificationChannel = {
  id: string;
  isEnabled: (preferences: NotificationPreferences) => boolean;
  send: (input: {
    userId: number;
    event: NotificationEvent;
    payload: NotificationPayload;
  }) => unknown;
};
type SessionRow = {
  provider?: string | null;
  session_id?: string | null;
};

const KIND_TO_PREF_KEY: Record<string, keyof NotificationPreferences['events']> = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error',
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: '',
  cursor: '',
  codex: 'Codex',
  system: 'System',
};

const recentEventKeys = new Map<string, number>();
const DEDUPE_WINDOW_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNotificationEvent(value: unknown): value is NotificationEvent {
  if (!isRecord(value) || !isRecord(value.meta)) return false;
  return typeof value.provider === 'string'
    && (typeof value.sessionId === 'string' || value.sessionId === null)
    && typeof value.kind === 'string'
    && typeof value.code === 'string'
    && typeof value.severity === 'string'
    && typeof value.requiresUserAction === 'boolean'
    && (typeof value.dedupeKey === 'string' || value.dedupeKey === null)
    && typeof value.createdAt === 'string';
}

function cleanupOldEventKeys(): void {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
}

function isNotificationEventEnabled(
  preferences: NotificationPreferences,
  event: NotificationEvent,
): boolean {
  const prefEventKey = KIND_TO_PREF_KEY[event.kind];
  return prefEventKey ? Boolean(preferences.events[prefEventKey]) : true;
}

function isDuplicate(event: NotificationEvent): boolean {
  cleanupOldEventKeys();
  const key = event.dedupeKey
    || `${event.provider}:${event.kind || 'info'}:${event.code || 'generic'}:${event.sessionId || 'none'}`;
  if (recentEventKeys.has(key)) {
    recentEventKeys.set(key, Date.now());
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

/** Used by provider runtimes, Settings, and routing alerts to normalize events. */
export function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info',
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false,
}: CreateNotificationEventInput): NotificationEvent {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString(),
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error == null) {
    return 'Unknown error';
  }
  return String(error);
}

function normalizeSessionName(sessionName: unknown): string | null {
  if (typeof sessionName !== 'string') {
    return null;
  }
  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function rowMatchesProvider(
  row: SessionRow | null | undefined,
  provider: string | null,
): row is SessionRow {
  return Boolean(row && (!provider || row.provider === provider));
}

function resolveSessionRow(sessionId: string | null, provider: string | null): SessionRow | null {
  if (!sessionId) {
    return null;
  }
  const appSessionRow = sessionsDb.getSessionById(sessionId);
  if (rowMatchesProvider(appSessionRow, provider)) {
    return appSessionRow;
  }
  const providerSessionRow = sessionsDb.getSessionByProviderSessionId(sessionId);
  if (rowMatchesProvider(providerSessionRow, provider)) {
    return providerSessionRow;
  }
  return null;
}

function normalizeNotificationSession(event: NotificationEvent): NotificationEvent {
  if (!event.sessionId || !event.provider || event.provider === 'system') {
    return event;
  }
  const row = resolveSessionRow(event.sessionId, event.provider);
  if (!row?.session_id || row.session_id === event.sessionId) {
    return event;
  }
  return { ...event, sessionId: row.session_id };
}

function resolveSessionName(event: NotificationEvent): string | null {
  const explicitSessionName = normalizeSessionName(event.meta.sessionName);
  if (explicitSessionName) {
    return explicitSessionName;
  }
  if (!event.sessionId || !event.provider) {
    return null;
  }
  return normalizeSessionName(sessionsDb.getSessionName(event.sessionId, event.provider));
}

/** Used by notification delivery and tests to build secret-free channel payloads. */
export function buildNotificationPayload(event: NotificationEvent): NotificationPayload {
  const normalizedEvent = normalizeNotificationSession(event);
  const codeMap: Record<string, string> = {
    'permission.required': normalizedEvent.meta.toolName
      ? `Action Required: Tool "${String(normalizedEvent.meta.toolName)}" needs approval`
      : 'Action Required: A tool needs your approval',
    'run.stopped': normalizedEvent.meta.stopReason
      ? String(normalizedEvent.meta.stopReason)
      : 'Run Stopped: The run has stopped',
    'run.failed': normalizedEvent.meta.error
      ? `Run Failed: ${String(normalizedEvent.meta.error)}`
      : 'Run Failed: The run encountered an error',
    'agent.notification': normalizedEvent.meta.message
      ? String(normalizedEvent.meta.message)
      : 'You have a new notification',
    'push.enabled': 'Push notifications are now enabled!',
  };
  const providerLabel = PROVIDER_LABELS[normalizedEvent.provider] || 'Assistant';
  const sessionName = resolveSessionName(normalizedEvent);
  const message = codeMap[normalizedEvent.code] || 'You have a new notification';

  return {
    title: sessionName || 'CloudCLI',
    body: `${providerLabel}: ${message}`,
    data: {
      sessionId: normalizedEvent.sessionId || null,
      code: normalizedEvent.code,
      provider: normalizedEvent.provider || null,
      sessionName,
      tag: `${normalizedEvent.provider || 'assistant'}:${normalizedEvent.sessionId || 'none'}:${normalizedEvent.code}`,
    },
  };
}

function rejectionStatusCode(reason: unknown): number | undefined {
  if (!reason || typeof reason !== 'object' || !('statusCode' in reason)) {
    return undefined;
  }
  const statusCode = Number(reason.statusCode);
  return Number.isFinite(statusCode) ? statusCode : undefined;
}

function sendWebPushPayload(userId: number, payload: NotificationPayload): Promise<unknown> {
  const subscriptions = pushSubscriptionsDb.getSubscriptions(userId);
  if (!subscriptions.length) return Promise.resolve();

  const serializedPayload = JSON.stringify(payload);
  return Promise.allSettled(
    subscriptions.map((subscription) => webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys_p256dh,
          auth: subscription.keys_auth,
        },
      },
      serializedPayload,
    )),
  ).then((results) => {
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const statusCode = rejectionStatusCode(result.reason);
      if (statusCode === 410 || statusCode === 404) {
        pushSubscriptionsDb.removeSubscription(subscriptions[index].endpoint);
      }
    });
  });
}

const notificationChannels: NotificationChannel[] = [
  {
    id: 'webPush',
    isEnabled: (preferences) => Boolean(preferences.channels.webPush),
    send: ({ userId, payload }) => sendWebPushPayload(userId, payload),
  },
];

/**
 * Used by provider runtimes, Settings, and routing alerts to queue enabled
 * channels. Returns false when preferences, dedupe, or channel availability
 * suppress delivery; asynchronous channel failures remain internally handled.
 */
export function notifyUserIfEnabled({
  userId,
  event,
}: {
  userId: number;
  event: unknown;
}): boolean {
  if (!userId || !isNotificationEvent(event)) {
    return false;
  }

  const normalizedEvent = normalizeNotificationSession(event);
  const preferences = notificationPreferencesDb.getPreferences(userId);
  if (!isNotificationEventEnabled(preferences, normalizedEvent)) {
    return false;
  }
  const enabledChannels = notificationChannels.filter((channel) => channel.isEnabled(preferences));
  if (enabledChannels.length === 0 || isDuplicate(normalizedEvent)) {
    return false;
  }

  const payload = buildNotificationPayload(normalizedEvent);
  for (const channel of enabledChannels) {
    Promise.resolve(channel.send({ userId, event: normalizedEvent, payload })).catch((error: unknown) => {
      console.error(`Notification channel "${channel.id}" send error:`, error);
    });
  }
  return true;
}

/** Used by provider runtimes to report a stopped or completed agent run. */
export function notifyRunStopped({
  userId,
  provider,
  sessionId = null,
  stopReason = 'completed',
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  stopReason?: string;
  sessionName?: string | null;
}): void {
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      severity: 'info',
      dedupeKey: `${provider}:run:stop:${sessionId || 'none'}:${stopReason}`,
    }),
  });
}

/** Used by provider runtimes to report a failed agent run. */
export function notifyRunFailed({
  userId,
  provider,
  sessionId = null,
  error,
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  error: unknown;
  sessionName?: string | null;
}): void {
  const errorMessage = normalizeErrorMessage(error);
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'error',
      code: 'run.failed',
      meta: { error: errorMessage, sessionName },
      severity: 'error',
      dedupeKey: `${provider}:run:error:${sessionId || 'none'}:${errorMessage}`,
    }),
  });
}
