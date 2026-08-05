const MAX_HEALTH_FIELD_LENGTH = 128;

export type NineRouterSidecarState = 'ready' | 'unavailable';

export type NineRouterSidecarSafeError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type NineRouterSidecarStatus = {
  state: NineRouterSidecarState;
  origin: string;
  version: string | null;
  lastError: NineRouterSidecarSafeError | null;
};

export type NineRouterInternalCredentials = {
  initialPassword: string;
  dataPlaneKey: string;
};

type NineRouterSidecarHealthResponse = {
  ok: boolean;
  version?: string;
};

type NineRouterSidecarDependencies = {
  baseUrl?: string;
  health(baseUrl: string): Promise<NineRouterSidecarHealthResponse>;
  credentials?: NineRouterInternalCredentials;
  onStatusChange?: (status: NineRouterSidecarStatus) => void;
};

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NINE_ROUTER_BASE_URL must be a valid http or https origin');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NINE_ROUTER_BASE_URL must use http or https');
  }
  if (url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new Error('NINE_ROUTER_BASE_URL must not include credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

function isValidVersion(value: string | undefined): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_HEALTH_FIELD_LENGTH
    && /^[\w .:@/-]+$/.test(value);
}

function unavailable(origin: string): NineRouterSidecarStatus {
  return {
    state: 'unavailable',
    origin,
    version: null,
    lastError: {
      code: 'ROUTING_SIDECAR_UNAVAILABLE',
      message: '9router sidecar health check failed',
      retryable: true,
    },
  };
}

/**
 * Used by routing module composition and tests to observe the Compose-owned
 * 9router sidecar. It performs health/status adaptation only and intentionally
 * exposes no process lifecycle operations because Compose owns the process.
 */
export function createNineRouterSidecarService(dependencies: NineRouterSidecarDependencies) {
  const origin = validateBaseUrl(dependencies.baseUrl ?? process.env.NINE_ROUTER_BASE_URL ?? 'http://9router:20128');
  const credentials = dependencies.credentials ?? { initialPassword: '', dataPlaneKey: '' };
  let status: NineRouterSidecarStatus = unavailable(origin);

  function cloneStatus(): NineRouterSidecarStatus {
    return { ...status, lastError: status.lastError ? { ...status.lastError } : null };
  }

  function transition(nextStatus: NineRouterSidecarStatus): NineRouterSidecarStatus {
    status = nextStatus;
    dependencies.onStatusChange?.(cloneStatus());
    return cloneStatus();
  }

  return {
    async refresh(): Promise<NineRouterSidecarStatus> {
      try {
        const result = await dependencies.health(origin);
        if (result.ok !== true || !isValidVersion(result.version)) return transition(unavailable(origin));
        return transition({ state: 'ready', origin, version: result.version, lastError: null });
      } catch {
        return transition(unavailable(origin));
      }
    },

    getStatus(): NineRouterSidecarStatus {
      return cloneStatus();
    },

    getInternalCredentials(): NineRouterInternalCredentials {
      return { ...credentials };
    },
  };
}
