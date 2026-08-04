import type { RuntimeRoutingConfiguration } from '@/shared/types.js';

type ClaudeRouteOptions = {
  model?: string;
  env?: Record<string, string>;
  unsetEnv?: string[];
};

type CodexRouteOptions = {
  model?: string;
  client?: {
    baseUrl: string;
    apiKey: string;
    env: NodeJS.ProcessEnv;
  };
};

type OpenCodeRouteOptions = {
  model: string;
  env: {
    OPENCODE_CONFIG_CONTENT: string;
  };
};

/** Used by the Claude runtime to isolate 9router endpoint and auth overrides to one run. */
export function buildClaudeRouteOptions(
  routing: RuntimeRoutingConfiguration | null | undefined,
): ClaudeRouteOptions {
  if (!routing || routing.source === 'native') {
    return {};
  }

  return {
    model: routing.routeName,
    env: {
      ANTHROPIC_BASE_URL: routing.baseUrl,
      ANTHROPIC_AUTH_TOKEN: routing.apiKey,
    },
    unsetEnv: ['ANTHROPIC_API_KEY'],
  };
}

/** Used by the Codex runtime to construct an optional per-run SDK client configuration. */
export function buildCodexRouteOptions(
  routing: RuntimeRoutingConfiguration | null | undefined,
): CodexRouteOptions {
  if (!routing || routing.source === 'native') {
    return {};
  }

  return {
    model: routing.routeName,
    client: {
      baseUrl: routing.openAiBaseUrl,
      apiKey: routing.apiKey,
      env: { ...process.env },
    },
  };
}

/** Used by the OpenCode runtime to build an inline provider config without writing global files. */
export function buildOpenCodeRouteOptions(
  routing: RuntimeRoutingConfiguration | null | undefined,
): OpenCodeRouteOptions | null {
  if (!routing || routing.source === 'native') {
    return null;
  }

  const model = `cloudcli-9router/${routing.routeName}`;
  return {
    model,
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: {
          'cloudcli-9router': {
            npm: '@ai-sdk/openai-compatible',
            name: '9Router',
            options: {
              baseURL: routing.openAiBaseUrl,
              apiKey: routing.apiKey,
            },
            models: {
              [routing.routeName]: { name: routing.routeName },
            },
          },
        },
        model,
      }),
    },
  };
}
