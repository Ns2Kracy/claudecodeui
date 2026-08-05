import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClaudeRouteOptions,
  buildCodexRouteOptions,
  buildOpenCodeRouteOptions,
} from '@/modules/providers/shared/routing/runtime-routing-options.js';
import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { RuntimeRoutingConfiguration } from '@/shared/types.js';

const routed: RuntimeRoutingConfiguration = {
  source: '9router',
  baseUrl: 'https://router.example/api',
  openAiBaseUrl: 'https://router.example/api/v1',
  apiKey: 'router-runtime-key',
  routeId: 'route-1',
  routeName: 'quality-first',
};

test('native routing leaves every provider runtime unchanged', () => {
  assert.deepEqual(buildClaudeRouteOptions({ source: 'native' }), {});
  assert.deepEqual(buildCodexRouteOptions({ source: 'native' }), {});
  assert.equal(buildOpenCodeRouteOptions({ source: 'native' }), null);
  assert.deepEqual(buildClaudeRouteOptions(undefined), {});
  assert.deepEqual(buildCodexRouteOptions(undefined), {});
  assert.equal(buildOpenCodeRouteOptions(undefined), null);
});

test('Claude routing sets only the per-run endpoint, token, and route model', () => {
  assert.deepEqual(buildClaudeRouteOptions(routed), {
    model: 'quality-first',
    env: {
      ANTHROPIC_BASE_URL: 'https://router.example/api',
      ANTHROPIC_AUTH_TOKEN: 'router-runtime-key',
    },
    unsetEnv: ['ANTHROPIC_API_KEY'],
  });
});

test('Claude SDK mapping applies routed env after native env and removes the native API key', () => {
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'native-api-key';
  try {
    const nativeOptions = mapCliOptionsToSDK({
      model: 'native-claude-model',
      routing: { source: 'native' },
    });
    assert.equal(nativeOptions.model, 'native-claude-model');
    assert.equal(nativeOptions.env.ANTHROPIC_API_KEY, 'native-api-key');

    const routedOptions = mapCliOptionsToSDK({
      model: 'native-claude-model',
      routing: routed,
    });
    assert.equal(routedOptions.model, 'quality-first');
    assert.equal(routedOptions.env.ANTHROPIC_BASE_URL, 'https://router.example/api');
    assert.equal(routedOptions.env.ANTHROPIC_AUTH_TOKEN, 'router-runtime-key');
    assert.equal('ANTHROPIC_API_KEY' in routedOptions.env, false);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
  }
});

test('Codex routing creates an isolated client configuration and route model', () => {
  const options = buildCodexRouteOptions(routed);

  assert.equal(options.model, 'quality-first');
  assert.equal(options.client?.baseUrl, 'https://router.example/api/v1');
  assert.equal(options.client?.apiKey, 'router-runtime-key');
  assert.notEqual(options.client?.env, process.env);
  assert.equal(options.client?.env.PATH, process.env.PATH);
});

test('OpenCode routing produces an isolated OpenAI-compatible inline configuration', () => {
  const options = buildOpenCodeRouteOptions(routed);

  assert.equal(options?.model, 'cloudcli-9router/quality-first');
  assert.deepEqual(options?.env ? Object.keys(options.env) : [], ['OPENCODE_CONFIG_CONTENT']);
  const configJson = options?.env.OPENCODE_CONFIG_CONTENT;
  assert.equal(typeof configJson, 'string');
  const config = JSON.parse(configJson as string);
  assert.deepEqual(config, {
    provider: {
      'cloudcli-9router': {
        npm: '@ai-sdk/openai-compatible',
        name: '9Router',
        options: {
          baseURL: 'https://router.example/api/v1',
          apiKey: 'router-runtime-key',
        },
        models: {
          'quality-first': { name: 'quality-first' },
        },
      },
    },
    model: 'cloudcli-9router/quality-first',
  });
  assert.equal(configJson?.includes('ANTHROPIC_API_KEY'), false);
  assert.equal(configJson?.includes('OPENAI_API_KEY'), false);
});
