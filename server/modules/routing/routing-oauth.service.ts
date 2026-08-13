import crypto from "node:crypto";

import type { IRoutingNineRouterClient } from "@/shared/interfaces.js";
import { AppError } from "@/shared/utils.js";

import type {
	RoutingAccountView,
	RoutingOAuthPollingStateView,
} from "../../../shared/routing.js";

const DEFAULT_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MIN_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 60_000;
const MAX_ID_LENGTH = 512;
const MAX_CODE_LENGTH = 4096;

type OAuthTopology =
	| { kind: "local"; serverPort?: number | string; publicUrl?: never }
	| { kind: "remote"; publicUrl?: string };

type RoutingOAuthServiceDependencies = {
	clientForRuntime(): Pick<
		IRoutingNineRouterClient,
		"startOAuth" | "exchangeOAuth" | "startDeviceCode" | "pollDeviceCode"
	>;
	now?: () => Date;
	randomId?: () => string;
	topology?: OAuthTopology;
	transactionTtlMs?: number;
	maxEntries?: number;
	minPollIntervalMs?: number;
	codexCallback?: { start(): Promise<string> };
};

type AuthTransaction = {
	kind: "auth-code";
	userId: number;
	provider: string;
	expiresAtMs: number;
	redirectUri: string;
	upstreamState: string;
	codeVerifier: string;
};

type DeviceTransaction = {
	kind: "device-code";
	userId: number;
	provider: string;
	expiresAtMs: number;
	deviceCode: string;
	codeVerifier: string;
	extraData?: unknown;
	intervalMs: number;
	nextPollAtMs: number;
};

type Transaction = AuthTransaction | DeviceTransaction;

function appError(message: string, code: string, statusCode = 400): AppError {
	return new AppError(message, { code, statusCode });
}

function invalidInput(): AppError {
	return appError(
		"Invalid routing OAuth request",
		"ROUTING_INVALID_REQUEST",
		400,
	);
}

function invalidState(): AppError {
	return appError(
		"The routing OAuth transaction is invalid or expired",
		"ROUTING_OAUTH_STATE_INVALID",
		400,
	);
}

function topologyUnsupported(): AppError {
	return appError(
		"This deployment topology does not support browser OAuth callbacks",
		"ROUTING_OAUTH_TOPOLOGY_UNSUPPORTED",
		409,
	);
}

function safeInteger(value: number, fallback: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function defaultRandomId(): string {
	return crypto.randomBytes(32).toString("base64url");
}

function boundedString(value: string, maxLength: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > maxLength)
		throw invalidInput();
	return value;
}

function safeUrl(value: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw appError(`${field} is invalid`, "ROUTING_INVALID_UPSTREAM_URL", 502);
	}
	const loopbackHttp =
		parsed.protocol === "http:" &&
		["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
	if (parsed.protocol !== "https:" && !loopbackHttp)
		throw appError(`${field} is invalid`, "ROUTING_INVALID_UPSTREAM_URL", 502);
	if (parsed.username || parsed.password)
		throw appError(`${field} is invalid`, "ROUTING_INVALID_UPSTREAM_URL", 502);
	return parsed.toString();
}

function callbackOrigin(topology: OAuthTopology): string {
	if (topology.kind === "local") {
		const port = String(topology.serverPort ?? process.env.SERVER_PORT ?? 3001);
		if (!/^\d{1,5}$/.test(port) || Number(port) <= 0 || Number(port) > 65535)
			throw topologyUnsupported();
		return `http://127.0.0.1:${port}`;
	}
	if (!topology.publicUrl) throw topologyUnsupported();
	let parsed: URL;
	try {
		parsed = new URL(topology.publicUrl);
	} catch {
		throw topologyUnsupported();
	}
	if (parsed.protocol !== "https:" || parsed.username || parsed.password)
		throw topologyUnsupported();
	return parsed.origin;
}

function callbackUrl(topology: OAuthTopology, provider: string): string {
	return `${callbackOrigin(topology)}/api/routing/oauth/${encodeURIComponent(provider)}/callback`;
}

function cloneExtra(value: unknown): unknown {
	return value === undefined ? undefined : structuredClone(value);
}

function constantTimeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Used by routing service and route tests to manage short-lived server-only OAuth transactions. */
export function createRoutingOAuthService(
	dependencies: RoutingOAuthServiceDependencies,
) {
	const now = dependencies.now ?? (() => new Date());
	const randomId = dependencies.randomId ?? defaultRandomId;
	const topology =
		dependencies.topology ??
		((process.env.CLOUDCLI_PUBLIC_URL
			? { kind: "remote", publicUrl: process.env.CLOUDCLI_PUBLIC_URL }
			: { kind: "local" }) as OAuthTopology);
	const ttlMs = safeInteger(
		dependencies.transactionTtlMs ?? DEFAULT_TRANSACTION_TTL_MS,
		DEFAULT_TRANSACTION_TTL_MS,
	);
	const maxEntries = safeInteger(
		dependencies.maxEntries ?? DEFAULT_MAX_ENTRIES,
		DEFAULT_MAX_ENTRIES,
	);
	const minPollIntervalMs = safeInteger(
		dependencies.minPollIntervalMs ?? DEFAULT_MIN_POLL_INTERVAL_MS,
		DEFAULT_MIN_POLL_INTERVAL_MS,
	);
	const transactions = new Map<string, Transaction>();

	function nowMs(): number {
		return now().getTime();
	}

	function cleanup(): void {
		const current = nowMs();
		for (const [id, tx] of transactions) {
			if (tx.expiresAtMs <= current) transactions.delete(id);
		}
		while (transactions.size > maxEntries) {
			const first = transactions.keys().next().value as string | undefined;
			if (first === undefined) break;
			transactions.delete(first);
		}
	}

	function store(transaction: Transaction): string {
		cleanup();
		let id = boundedString(randomId(), MAX_ID_LENGTH);
		for (let attempt = 0; transactions.has(id) && attempt < 8; attempt += 1) {
			id = boundedString(randomId(), MAX_ID_LENGTH);
		}
		if (transactions.has(id))
			throw appError(
				"Unable to allocate OAuth transaction",
				"ROUTING_OAUTH_CAPACITY_EXCEEDED",
				503,
			);
		transactions.set(id, transaction);
		cleanup();
		return id;
	}

	function readTransaction(
		id: string,
		userId: number,
		provider: string,
		kind: Transaction["kind"],
	): Transaction {
		cleanup();
		const tx = transactions.get(boundedString(id, MAX_ID_LENGTH));
		if (
			!tx ||
			tx.userId !== userId ||
			tx.provider !== provider ||
			tx.kind !== kind ||
			tx.expiresAtMs <= nowMs()
		)
			throw invalidState();
		return tx;
	}

	return {
		async startAuthorizationCode(userId: number, provider: string) {
			const safeProvider = boundedString(provider, 64);
			const codexCallback = dependencies.codexCallback;
			if (
				safeProvider === "codex" &&
				(topology.kind !== "local" || !codexCallback)
			)
				throw topologyUnsupported();
			const callbackTarget = callbackUrl(topology, safeProvider);
			const redirectUri =
				safeProvider === "codex" && codexCallback
					? safeUrl(await codexCallback.start(), "redirectUri")
					: callbackTarget;
			const started = await dependencies
				.clientForRuntime()
				.startOAuth(safeProvider, redirectUri);
			const authUrl = safeUrl(started.authUrl, "authUrl");
			const upstreamRedirectUri = safeUrl(started.redirectUri, "redirectUri");
			if (upstreamRedirectUri !== safeUrl(redirectUri, "redirectUri"))
				throw appError(
					"OAuth redirect URI mismatch",
					"ROUTING_INVALID_UPSTREAM_URL",
					502,
				);
			const transactionId = store({
				kind: "auth-code",
				userId,
				provider: safeProvider,
				expiresAtMs: nowMs() + ttlMs,
				redirectUri,
				upstreamState: boundedString(started.state, MAX_ID_LENGTH),
				codeVerifier: boundedString(started.codeVerifier, MAX_ID_LENGTH),
			});
			return {
				provider: safeProvider,
				transactionId,
				authUrl,
				redirectUri,
				expiresAt: new Date(nowMs() + ttlMs).toISOString(),
			};
		},

		async completeAuthorizationCode(
			userId: number,
			provider: string,
			input: { transactionId: string; state: string; code: string },
		): Promise<RoutingAccountView> {
			const safeProvider = boundedString(provider, 64);
			boundedString(input.state, MAX_ID_LENGTH);
			const code = boundedString(input.code, MAX_CODE_LENGTH);
			const tx = readTransaction(
				input.transactionId,
				userId,
				safeProvider,
				"auth-code",
			) as AuthTransaction;
			if (!constantTimeEqual(input.state, tx.upstreamState))
				throw invalidState();
			transactions.delete(input.transactionId);
			return dependencies
				.clientForRuntime()
				.exchangeOAuth(safeProvider, {
					code,
					redirectUri: tx.redirectUri,
					codeVerifier: tx.codeVerifier,
					state: tx.upstreamState,
				});
		},

		async startDeviceCode(userId: number, provider: string) {
			const safeProvider = boundedString(provider, 64);
			const started = await dependencies
				.clientForRuntime()
				.startDeviceCode(safeProvider);
			const intervalMs = Math.min(
				DEFAULT_MAX_POLL_INTERVAL_MS,
				Math.max(
					minPollIntervalMs,
					safeInteger((started.interval ?? 0) * 1_000, minPollIntervalMs),
				),
			);
			const expiresAtMs = Math.min(
				nowMs() + ttlMs,
				nowMs() +
					safeInteger(
						(started.expiresIn ?? Math.floor(ttlMs / 1_000)) * 1_000,
						ttlMs,
					),
			);
			const transactionId = store({
				kind: "device-code",
				userId,
				provider: safeProvider,
				expiresAtMs,
				deviceCode: boundedString(started.deviceCode, MAX_ID_LENGTH),
				codeVerifier: boundedString(started.codeVerifier, MAX_ID_LENGTH),
				extraData: cloneExtra(started.extraData),
				intervalMs,
				nextPollAtMs: nowMs(),
			});
			return {
				provider: safeProvider,
				transactionId,
				userCode: boundedString(started.userCode, 256),
				verificationUri: safeUrl(started.verificationUri, "verificationUri"),
				verificationUriComplete:
					started.verificationUriComplete === null
						? null
						: safeUrl(
								started.verificationUriComplete,
								"verificationUriComplete",
							),
				expiresAt: new Date(expiresAtMs).toISOString(),
				interval: Math.ceil(intervalMs / 1_000),
			};
		},

		async pollDeviceCode(
			userId: number,
			provider: string,
			input: { transactionId: string },
		): Promise<RoutingOAuthPollingStateView> {
			const safeProvider = boundedString(provider, 64);
			const tx = readTransaction(
				input.transactionId,
				userId,
				safeProvider,
				"device-code",
			) as DeviceTransaction;
			if (nowMs() < tx.nextPollAtMs)
				throw appError(
					"OAuth polling interval has not elapsed",
					"ROUTING_OAUTH_POLL_INTERVAL",
					429,
				);
			tx.nextPollAtMs = nowMs() + tx.intervalMs;
			const result = await dependencies
				.clientForRuntime()
				.pollDeviceCode(safeProvider, {
					deviceCode: tx.deviceCode,
					codeVerifier: tx.codeVerifier,
					extraData: tx.extraData,
				});
			if (!result.pending && result.account === null) {
				transactions.delete(input.transactionId);
				throw appError(
					"OAuth device-code polling returned no account",
					"ROUTING_OAUTH_POLL_FAILED",
					502,
				);
			}
			if (!result.pending) transactions.delete(input.transactionId);
			return {
				provider: result.provider,
				pending: result.pending,
				account: result.account,
			};
		},

		async cancelDeviceCode(
			userId: number,
			provider: string,
			input: { transactionId: string },
		): Promise<{ cancelled: true }> {
			const safeProvider = boundedString(provider, 64);
			readTransaction(input.transactionId, userId, safeProvider, "device-code");
			transactions.delete(input.transactionId);
			return { cancelled: true };
		},
	};
}
