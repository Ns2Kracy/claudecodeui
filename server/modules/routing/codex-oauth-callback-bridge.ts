import crypto from "node:crypto";
import http from "node:http";

const DEFAULT_PORT = 1455;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_REQUEST_URL_LENGTH = 4_096;
const CALLBACK_PATH = "/auth/callback";

type CodexOAuthCallbackBridgeDependencies = {
	port?: number;
	host?: string;
	idleTimeoutMs?: number;
};

/** Used by routing.module and its tests to serve Codex's fixed localhost OAuth callback. */
export function createCodexOAuthCallbackBridge(
	dependencies: CodexOAuthCallbackBridgeDependencies = {},
) {
	const port = dependencies.port ?? DEFAULT_PORT;
	const host = dependencies.host ?? "127.0.0.1";
	const idleTimeoutMs = dependencies.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	let server: http.Server | null = null;
	let idleTimer: NodeJS.Timeout | null = null;

	const close = async (): Promise<void> => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = null;
		const current = server;
		server = null;
		if (!current) return;
		current.closeAllConnections();
		await new Promise<void>((resolve) => current.close(() => resolve()));
	};

	const armIdleTimer = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			void close();
		}, idleTimeoutMs);
		idleTimer.unref();
	};

	const handleRequest: http.RequestListener = (request, response) => {
		armIdleTimer();
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Referrer-Policy", "no-referrer");
		if (request.method !== "GET") {
			response.writeHead(405, { Allow: "GET" }).end();
			return;
		}
		if (!request.url || request.url.length > MAX_REQUEST_URL_LENGTH) {
			response.writeHead(414).end();
			return;
		}
		let incoming: URL;
		try {
			incoming = new URL(request.url, "http://127.0.0.1");
		} catch {
			response.writeHead(400).end();
			return;
		}
		if (incoming.pathname !== CALLBACK_PATH) {
			response.writeHead(404).end();
			return;
		}
		const nonce = crypto.randomBytes(16).toString("base64url");
		response.setHeader(
			"Content-Security-Policy",
			`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
		);
		response
			.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
			.end(
				`<!doctype html><html><head><meta charset="utf-8"><title>Codex connected</title></head><body><p>Codex authorization received. You may close this window.</p><script nonce="${nonce}">try{if(window.opener)window.opener.postMessage({type:'routing-oauth-callback',url:window.location.href},'*')}catch(_){}</script></body></html>`,
			);
	};

	return {
		async start(): Promise<string> {
			if (!server) {
				const nextServer = http.createServer(handleRequest);
				server = nextServer;
				await new Promise<void>((resolve, reject) => {
					nextServer.once("error", reject);
					nextServer.listen(port, host, () => {
						nextServer.off("error", reject);
						resolve();
					});
				});
			}
			armIdleTimer();
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Codex callback bridge did not bind a TCP port");
			return `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
		},
		close,
	};
}
