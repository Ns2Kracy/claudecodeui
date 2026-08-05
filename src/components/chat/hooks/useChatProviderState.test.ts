import assert from 'node:assert/strict';
import test from 'node:test';

import { readProviderModelsApiData, withUnavailableSelectedModel } from './useChatProviderState.js';

test('provider model response parsing preserves 9router source metadata as model metadata only', () => {
  const data = readProviderModelsApiData({
    success: true,
    data: {
      models: {
        DEFAULT: 'claude-sonnet-4-5',
        OPTIONS: [
          { value: 'claude-sonnet-4-5', label: 'Claude Sonnet', source: 'native' },
          { value: '9router:anthropic/claude-opus', label: 'Anthropic · Claude Opus', source: '9router' },
        ],
      },
      cache: {
        updatedAt: '2026-08-05T00:00:00.000Z',
        expiresAt: '2026-08-08T00:00:00.000Z',
        source: 'fresh',
      },
    },
  });

  assert.ok(data?.models);
  assert.deepEqual(data.models.OPTIONS, [
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet', source: 'native' },
    { value: '9router:anthropic/claude-opus', label: 'Anthropic · Claude Opus', source: '9router' },
  ]);
});

test('preserves a disappeared 9router session model as visibly unavailable', () => {
  const options = [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet', source: 'native' as const }];

  assert.deepEqual(withUnavailableSelectedModel(options, '9router:anthropic/removed-model'), [
    ...options,
    {
      value: '9router:anthropic/removed-model',
      label: 'anthropic/removed-model (Provider unavailable)',
      source: '9router',
    },
  ]);
  assert.strictEqual(withUnavailableSelectedModel(options, 'claude-sonnet-4-5'), options);
});
