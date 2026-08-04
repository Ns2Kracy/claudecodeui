import type { RoutingUsageView } from '../../../../../../shared/routing.js';

const USD_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{0,6}))?$/;
const MICROUSD_PER_USD = 1_000_000;

export function parseUsdToMicrousd(value: string): number | null {
  const normalized = value.trim();
  const match = USD_DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;

  const whole = Number(normalized.split('.')[0]);
  const fraction = Number((match[1] ?? '').padEnd(6, '0'));
  if (!Number.isSafeInteger(whole) || whole > Math.floor(Number.MAX_SAFE_INTEGER / MICROUSD_PER_USD)) {
    return null;
  }
  const microusd = (whole * MICROUSD_PER_USD) + fraction;
  return Number.isSafeInteger(microusd) ? microusd : null;
}

export function formatMicrousdInput(value: number): string {
  const whole = Math.floor(value / MICROUSD_PER_USD);
  const fraction = String(value % MICROUSD_PER_USD).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

type ProviderDistributionRow = RoutingUsageView['byProvider'][number] & {
  percent: number;
};

export function providerDistribution(usage: RoutingUsageView): {
  basis: 'cost' | 'requests';
  rows: ProviderDistributionRow[];
} {
  const totalCost = usage.byProvider.reduce((total, row) => total + row.costMicrousd, 0);
  const basis = totalCost > 0 ? 'cost' : 'requests';
  const denominator = basis === 'cost'
    ? totalCost
    : usage.byProvider.reduce((total, row) => total + row.requests, 0);
  const metric = (row: RoutingUsageView['byProvider'][number]) => (
    basis === 'cost' ? row.costMicrousd : row.requests
  );

  return {
    basis,
    rows: usage.byProvider
      .map((row) => ({
        ...row,
        percent: denominator > 0
          ? Math.max(0, Math.min(100, (metric(row) / denominator) * 100))
          : 0,
      }))
      .sort((first, second) => metric(second) - metric(first) || first.id.localeCompare(second.id)),
  };
}
