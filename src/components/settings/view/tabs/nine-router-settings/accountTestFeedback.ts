import type { RoutingAccountTestResult } from "./routingApi.js";

export type AccountTestRecord = {
	result: RoutingAccountTestResult;
	completedAt: string;
	durationMs: number;
};

export async function collectAccountTestRecord(
	operation: () => Promise<RoutingAccountTestResult | null>,
	fallbackError: string,
	monotonicNow: () => number = () => performance.now(),
	wallClock: () => Date = () => new Date(),
): Promise<AccountTestRecord> {
	const startedAt = monotonicNow();
	let result: RoutingAccountTestResult | null = null;
	try {
		result = await operation();
	} catch {
		// The settings controller normally converts transport errors to null. This
		// guard keeps unexpected promise failures visible without leaking details.
	}

	const error = result?.error?.trim();
	return {
		result:
			result?.healthy === true
				? result
				: {
						healthy: false,
						error: error || fallbackError,
						refreshed: result?.refreshed ?? false,
					},
		completedAt: wallClock().toISOString(),
		durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
	};
}
