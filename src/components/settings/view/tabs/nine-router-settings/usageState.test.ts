import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoutingUsageView } from '../../../../../../shared/routing.js';

import {
  formatMicrousdInput,
  parseUsdToMicrousd,
  providerDistribution,
} from './usageState.js';

test('USD alert input converts to integer micro-USD without floating-point money', () => {
  assert.equal(parseUsdToMicrousd('0'), 0);
  assert.equal(parseUsdToMicrousd('1'), 1_000_000);
  assert.equal(parseUsdToMicrousd('12.345678'), 12_345_678);
  assert.equal(parseUsdToMicrousd('0.000001'), 1);
  assert.equal(parseUsdToMicrousd('1.'), 1_000_000);
});

test('USD alert input rejects negatives, exponent notation, excess precision, and unsafe totals', () => {
  for (const value of ['-1', '1e3', '01', '.5', '1.0000001', 'abc', '', '9007199254740991']) {
    assert.equal(parseUsdToMicrousd(value), null, value);
  }
});

test('micro-USD alert values format as canonical editable decimal strings', () => {
  assert.equal(formatMicrousdInput(0), '0');
  assert.equal(formatMicrousdInput(1), '0.000001');
  assert.equal(formatMicrousdInput(1_500_000), '1.5');
  assert.equal(formatMicrousdInput(12_345_678), '12.345678');
});

test('provider distribution prefers cost and keeps stable descending rows', () => {
  const usage: RoutingUsageView = {
    period: '30d',
    requests: 16,
    promptTokens: 100,
    completionTokens: 20,
    estimatedCostMicrousd: 1_000,
    staleAt: null,
    byProvider: [
      { id: 'beta', requests: 10, costMicrousd: 250 },
      { id: 'alpha', requests: 5, costMicrousd: 750 },
      { id: 'zero', requests: 1, costMicrousd: 0 },
    ],
  };

  assert.deepEqual(providerDistribution(usage), {
    basis: 'cost',
    rows: [
      { id: 'alpha', requests: 5, costMicrousd: 750, percent: 75 },
      { id: 'beta', requests: 10, costMicrousd: 250, percent: 25 },
      { id: 'zero', requests: 1, costMicrousd: 0, percent: 0 },
    ],
  });
});

test('provider distribution falls back to requests without NaN widths', () => {
  const usage: RoutingUsageView = {
    period: 'today',
    requests: 3,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostMicrousd: 0,
    staleAt: null,
    byProvider: [
      { id: 'beta', requests: 1, costMicrousd: 0 },
      { id: 'alpha', requests: 2, costMicrousd: 0 },
    ],
  };

  const distribution = providerDistribution(usage);
  assert.equal(distribution.basis, 'requests');
  assert.equal(distribution.rows[0].id, 'alpha');
  assert.ok(Math.abs(distribution.rows[0].percent - (200 / 3)) < 0.0001);
  assert.equal(providerDistribution({ ...usage, byProvider: [] }).rows.length, 0);
});
