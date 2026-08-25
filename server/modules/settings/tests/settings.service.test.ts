import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsService } from "../settings.service.js";

type Dependencies = Parameters<typeof createSettingsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
	return {
		apiKeys: {
			list: () => [],
			create: () => ({}),
			remove: () => false,
			toggle: () => false,
		},
		credentials: {
			list: () => [],
			create: () => ({}),
			remove: () => false,
			toggle: () => false,
		},
		notifications: {
			getPreferences: () => undefined,
			updatePreferences: () => ({}),
			createEnabledEvent: () => ({}),
			notifyUser: () => undefined,
		},
		pushSubscriptions: { save: () => undefined, remove: () => undefined },
		workspace: {
			getPolicy: async () => ({
				strictIsolation: false,
				isolationAvailable: true,
				isolationReason: null,
			}),
			updatePolicy: async () => ({
				strictIsolation: false,
				isolationAvailable: true,
				isolationReason: null,
			}),
		},
		getVapidPublicKey: () => null,
		...overrides,
	};
}

test('workspace settings are read through the workspace policy boundary', async () => {
	const service = createSettingsService(dependencies());
	const result = await service.getWorkspacePolicy();
	assert.equal(result.strictIsolation, false);
});

test('workspace settings updates pass only the protection choice', async () => {
	let captured: unknown = null;
	const service = createSettingsService(dependencies({
		workspace: {
			getPolicy: async () => { throw new Error('unused'); },
			updatePolicy: async (input) => {
				captured = input;
				return {
					strictIsolation: true, isolationAvailable: true, isolationReason: null,
				};
			},
		},
	}));
	const result = await service.updateWorkspacePolicy({
		workspaceRoot: '/media/projects', strictIsolation: true, ignored: 'value',
	});
	assert.deepEqual(captured, { strictIsolation: true });
	assert.equal(result.strictIsolation, true);
});

test("listApiKeys redacts secret values through the service boundary", () => {
	const fixtureKey = ["redaction", "fixture", "value"].join("-");
	const service = createSettingsService(
		dependencies({
			apiKeys: {
				list: () => [{ id: 1, api_key: fixtureKey }],
				create: () => ({}),
				remove: () => false,
				toggle: () => false,
			},
		}),
	);
	assert.equal(service.listApiKeys(1).apiKeys[0]?.api_key, "redaction-...");
});

test("subscribeToPush persists the subscription and enables Web Push", () => {
	const operations: string[] = [];
	const service = createSettingsService(
		dependencies({
			pushSubscriptions: {
				save: (_id, endpoint) => operations.push(`save:${endpoint}`),
				remove: () => undefined,
			},
			notifications: {
				getPreferences: () => ({ channels: { webPush: false } }),
				updatePreferences: () => {
					operations.push("preferences");
					return {};
				},
				createEnabledEvent: () => ({ code: "push.enabled" }),
				notifyUser: () => {
					operations.push("notify");
				},
			},
		}),
	);

	service.subscribeToPush(1, {
		endpoint: "https://push.example.test",
		keys: { p256dh: "key", auth: "auth" },
	});
	assert.deepEqual(operations, [
		"save:https://push.example.test",
		"preferences",
		"notify",
	]);
});
