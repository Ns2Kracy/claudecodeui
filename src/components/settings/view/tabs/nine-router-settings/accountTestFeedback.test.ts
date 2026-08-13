import assert from "node:assert/strict";
import test from "node:test";

import { collectAccountTestRecord } from "./accountTestFeedback.js";

const fallback = "The Provider Router could not complete the test.";

function clocks(...values: number[]): () => number {
	let index = 0;
	return () => values[index++] ?? values.at(-1) ?? 0;
}

test("unhealthy account tests always include a failure reason", async () => {
	const record = await collectAccountTestRecord(
		async () => ({ healthy: false, error: null, refreshed: false }),
		fallback,
		clocks(100, 226),
		() => new Date("2026-08-13T09:30:00.000Z"),
	);

	assert.deepEqual(record, {
		result: { healthy: false, error: fallback, refreshed: false },
		completedAt: "2026-08-13T09:30:00.000Z",
		durationMs: 126,
	});
});

test("rejected account tests become safe visible failure records", async () => {
	const record = await collectAccountTestRecord(
		async () => {
			throw new Error("internal bearer token: secret");
		},
		fallback,
		clocks(100, 508),
		() => new Date("2026-08-13T09:30:00.000Z"),
	);

	assert.equal(record.result.healthy, false);
	assert.equal(record.result.error, fallback);
	assert.equal(record.result.refreshed, false);
	assert.equal(record.durationMs, 408);
});
