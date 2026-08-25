import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { WebSocket } from "ws";

import { handleShellConnection } from "@/modules/websocket/services/shell-websocket.service.js";

function createFakeSocket() {
	const socket = new EventEmitter() as EventEmitter & {
		readyState: number;
		frames: string[];
		send: (data: string) => void;
	};
	socket.readyState = WebSocket.OPEN;
	socket.frames = [];
	socket.send = (data: string) => socket.frames.push(data);
	return socket;
}

function createFakePty() {
	let dataListener: ((data: string) => void) | null = null;
	let exitListener:
		| ((event: { exitCode: number; signal?: number }) => void)
		| null = null;

	return {
		killed: false,
		onData(listener: (data: string) => void) {
			dataListener = listener;
			return { dispose: () => undefined };
		},
		onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
			exitListener = listener;
			return { dispose: () => undefined };
		},
		emitData(data: string) {
			dataListener?.(data);
		},
		emitExit() {
			exitListener?.({ exitCode: 0 });
		},
		write() {},
		resize() {},
		kill() {
			this.killed = true;
		},
	};
}

test("a stale socket close cannot detach the socket that replaced it", () => {
	const pty = createFakePty();
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveCodexShellRouting: async () => {
			throw new Error("not used by plain shell");
		},
		spawnPty: () => pty as never,
	};
	const initMessage = JSON.stringify({
		type: "init",
		projectPath: process.cwd(),
		sessionId: `stale-close-${Date.now()}`,
		hasSession: false,
		provider: "plain-shell",
		isPlainShell: true,
		initialCommand: "test-command",
	});

	const firstSocket = createFakeSocket();
	handleShellConnection(firstSocket as never, dependencies);
	firstSocket.emit("message", initMessage);

	const replacementSocket = createFakeSocket();
	handleShellConnection(replacementSocket as never, dependencies);
	replacementSocket.emit("message", initMessage);
	replacementSocket.frames.length = 0;

	// This ordering reproduces a delayed close from a backgrounded mobile tab.
	firstSocket.emit("close");
	pty.emitData("output-after-stale-close");

	assert.equal(pty.killed, false);
	assert.equal(replacementSocket.frames.length, 1);
	assert.match(replacementSocket.frames[0], /output-after-stale-close/);

	pty.emitExit();
});

test("shell output detects and normalizes a wrapped authentication URL", () => {
	const pty = createFakePty();
	const socket = createFakeSocket();
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveCodexShellRouting: async () => {
			throw new Error("not used by plain shell");
		},
		spawnPty: () => pty as never,
	};

	handleShellConnection(socket as never, dependencies);
	socket.emit(
		"message",
		JSON.stringify({
			type: "init",
			projectPath: process.cwd(),
			sessionId: `wrapped-url-${Date.now()}`,
			hasSession: false,
			provider: "plain-shell",
			isPlainShell: true,
			initialCommand: "test-command",
		}),
	);
	socket.frames.length = 0;

	pty.emitData(
		"Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m",
	);

	const frames = socket.frames.map(
		(frame) => JSON.parse(frame) as Record<string, unknown>,
	);
	const authenticationFrame = frames.find((frame) => frame.type === "auth_url");
	assert.deepEqual(authenticationFrame, {
		type: "auth_url",
		url: "https://example.com/authorize?code=abc",
		autoOpen: false,
	});

	pty.emitExit();
});

test("agent-backed shell injects routed Codex credentials only into its PTY", async () => {
	const pty = createFakePty();
	const socket = createFakeSocket();
	let shellExecutable = "";
	let shellArguments: readonly string[] = [];
	let shellEnvironment: Record<string, string | undefined> = {};
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveCodexShellRouting: async () => ({
			source: "9router" as const,
			baseUrl: "https://router.example/api",
			openAiBaseUrl: "https://router.example/v1",
			apiKey: "temporary-router-key",
			routeName: "openai/gpt-5.4",
			model: "openai/gpt-5.4",
		}),
		spawnPty: (
			file: string,
			args: readonly string[],
			options: { env?: Record<string, string | undefined> },
		) => {
			shellExecutable = file;
			shellArguments = args;
			shellEnvironment = options.env ?? {};
			return pty as never;
		},
	};

	handleShellConnection(socket as never, dependencies as never);
	socket.emit(
		"message",
		JSON.stringify({
			type: "init",
			projectPath: process.cwd(),
			sessionId: null,
			hasSession: false,
			provider: "codex",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));

	const command = shellArguments.join(" ");
	assert.match(shellExecutable, /bash|powershell/i);
	assert.match(command, /openai_base_url/);
	assert.match(command, /CLOUDCLI_CODEX_BASE_URL/);
	assert.match(command, /CLOUDCLI_CODEX_MODEL/);
	assert.doesNotMatch(
		command,
		/temporary-router-key|router\.example|openai\/gpt-5\.4/,
	);
	assert.equal(shellEnvironment.CODEX_API_KEY, "temporary-router-key");
	assert.equal(
		shellEnvironment.CLOUDCLI_CODEX_BASE_URL,
		"https://router.example/v1",
	);
	assert.equal(shellEnvironment.CLOUDCLI_CODEX_MODEL, "openai/gpt-5.4");

	pty.emitExit();
});

test("agent-backed shell always starts Codex even for a stale provider value", async () => {
	const pty = createFakePty();
	const socket = createFakeSocket();
	let shellExecutable = "";
	let shellArguments: readonly string[] = [];
	let shellEnvironment: Record<string, string | undefined> = {};
	const dependencies = {
		resolveProviderSessionId: () => "native-session",
		resolveCodexShellRouting: async () => ({
			source: "9router" as const,
			baseUrl: "https://router.example/api",
			openAiBaseUrl: "https://router.example/v1",
			apiKey: "temporary-router-key",
			routeName: "openai/gpt-5.4",
			model: "openai/gpt-5.4",
		}),
		spawnPty: (
			file: string,
			args: readonly string[],
			options: { env?: Record<string, string | undefined> },
		) => {
			shellExecutable = file;
			shellArguments = args;
			shellEnvironment = options.env ?? {};
			return pty as never;
		},
	};

	handleShellConnection(socket as never, dependencies as never);
	socket.emit(
		"message",
		JSON.stringify({
			type: "init",
			projectPath: process.cwd(),
			sessionId: `codex-only-${Date.now()}`,
			hasSession: true,
			provider: "claude",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));

	assert.match(shellExecutable, /bash|powershell/i);
	assert.match(shellArguments.join(" "), /codex.*resume/);
	assert.equal(shellEnvironment.CLOUDCLI_CODEX_RESUME_ID, "native-session");
	assert.doesNotMatch(shellArguments.join(" "), /claude|cursor-agent|opencode/);
	const output = socket.frames.join("\n");
	assert.match(output, /Resuming Codex session native-session/);

	pty.emitExit();
});

test("closing the socket while Codex routing resolves does not spawn a PTY", async () => {
	const socket = createFakeSocket();
	let resolveRouting!: (routing: {
		source: "9router";
		baseUrl: string;
		openAiBaseUrl: string;
		apiKey: string;
		routeName: string;
		model: string;
	}) => void;
	let spawned = false;
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveCodexShellRouting: () =>
			new Promise((resolve) => {
				resolveRouting = resolve;
			}),
		spawnPty: () => {
			spawned = true;
			return createFakePty() as never;
		},
	};

	handleShellConnection(socket as never, dependencies as never);
	socket.emit(
		"message",
		JSON.stringify({
			type: "init",
			projectPath: process.cwd(),
			provider: "codex",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	socket.readyState = WebSocket.CLOSED;
	socket.emit("close");
	resolveRouting({
		source: "9router",
		baseUrl: "https://router.example/api",
		openAiBaseUrl: "https://router.example/v1",
		apiKey: "temporary-router-key",
		routeName: "openai/gpt-5.4",
		model: "openai/gpt-5.4",
	});
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(spawned, false);
});

test("a different init cannot overtake pending Codex routing initialization", async () => {
	const pty = createFakePty();
	const socket = createFakeSocket();
	let resolveRouting!: (routing: {
		source: "9router";
		baseUrl: string;
		openAiBaseUrl: string;
		apiKey: string;
		routeName: string;
		model: string;
	}) => void;
	let routingCalls = 0;
	let spawnCalls = 0;
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveCodexShellRouting: () => {
			routingCalls += 1;
			return new Promise((resolve) => {
				resolveRouting = resolve;
			});
		},
		spawnPty: () => {
			spawnCalls += 1;
			return pty as never;
		},
	};
	const codexInitMessage = JSON.stringify({
		type: "init",
		projectPath: process.cwd(),
		provider: "codex",
	});
	const plainShellInitMessage = JSON.stringify({
		type: "init",
		projectPath: process.cwd(),
		provider: "plain-shell",
		isPlainShell: true,
		initialCommand: "pwd",
	});

	handleShellConnection(socket as never, dependencies as never);
	socket.emit("message", codexInitMessage);
	socket.emit("message", plainShellInitMessage);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(routingCalls, 1);
	resolveRouting({
		source: "9router",
		baseUrl: "https://router.example/api",
		openAiBaseUrl: "https://router.example/v1",
		apiKey: "temporary-router-key",
		routeName: "openai/gpt-5.4",
		model: "openai/gpt-5.4",
	});
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(spawnCalls, 1);
	pty.emitExit();
});

test("agent-backed shell does not spawn an unauthenticated Codex process when routing fails", async () => {
	const socket = createFakeSocket();
	let spawned = false;
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveCodexShellRouting: async () => {
			throw new Error("Router is unavailable");
		},
		spawnPty: () => {
			spawned = true;
			return createFakePty() as never;
		},
	};

	handleShellConnection(socket as never, dependencies as never);
	socket.emit(
		"message",
		JSON.stringify({
			type: "init",
			projectPath: process.cwd(),
			sessionId: `routing-failure-${Date.now()}`,
			provider: "codex",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(spawned, false);
	assert.match(socket.frames.join("\n"), /Router is unavailable/);
});


test('strict workspace launch wraps the agent-backed Codex shell', async () => {
	const pty = createFakePty();
	const socket = createFakeSocket();
	let shellArguments: readonly string[] = [];
	let shellEnvironment: Record<string, string | undefined> = {};
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveWorkspaceLaunch: async (projectPath: string) => ({
			workingDirectory: projectPath,
			codexPathOverride: '/app/scripts/codex-bwrap-wrapper.sh',
			replaceEnvironment: true,
			environment: {
				PATH: '/usr/bin', HOME: '/root', CLOUDCLI_WORKSPACE_ROOT: projectPath,
				CLOUDCLI_CODEX_BINARY: '/usr/local/libexec/cloudcli/codex-real',
			},
		}),
		resolveCodexShellRouting: async () => ({
			source: '9router' as const, baseUrl: 'https://router.example/api',
			openAiBaseUrl: 'https://router.example/v1', apiKey: 'temporary-router-key',
			routeName: 'openai/gpt-5.4', model: 'openai/gpt-5.4',
		}),
		spawnPty: (_file: string, args: readonly string[], options: { env?: Record<string, string | undefined> }) => {
			shellArguments = args;
			shellEnvironment = options.env ?? {};
			return pty as never;
		},
	};

	handleShellConnection(socket as never, dependencies as never);
	socket.emit('message', JSON.stringify({ type: 'init', projectPath: process.cwd(), provider: 'codex' }));
	await new Promise((resolve) => setImmediate(resolve));

	assert.match(shellArguments.join(' '), /CLOUDCLI_CODEX_WRAPPER/);
	assert.equal(shellEnvironment.CLOUDCLI_CODEX_WRAPPER, '/app/scripts/codex-bwrap-wrapper.sh');
	assert.equal(shellEnvironment.CLOUDCLI_WORKSPACE_ROOT, process.cwd());
	assert.equal(shellEnvironment.DATABASE_PATH, undefined);
	pty.emitExit();
});

test('retained Codex PTYs are not reused after strict isolation changes', async () => {
	const sessionId = `policy-change-${Date.now()}`;
	const firstPty = createFakePty();
	const secondPty = createFakePty();
	let spawnCount = 0;
	let strictMode = false;
	const dependencies = {
		resolveProviderSessionId: () => null,
		resolveWorkspaceLaunch: async (projectPath: string) => ({
			workingDirectory: projectPath,
			codexPathOverride: strictMode ? '/app/scripts/codex-bwrap-wrapper.sh' : undefined,
			replaceEnvironment: strictMode,
			environment: strictMode ? {
				PATH: '/usr/bin', HOME: '/root', CLOUDCLI_WORKSPACE_ROOT: projectPath,
				CLOUDCLI_CODEX_BINARY: '/usr/local/libexec/cloudcli/codex-real',
			} : {},
		}),
		resolveCodexShellRouting: async () => ({
			source: '9router' as const, baseUrl: 'https://router.example/api',
			openAiBaseUrl: 'https://router.example/v1', apiKey: 'temporary-router-key',
			routeName: 'openai/gpt-5.4', model: 'openai/gpt-5.4',
		}),
		spawnPty: () => {
			spawnCount += 1;
			return (spawnCount === 1 ? firstPty : secondPty) as never;
		},
	};
	const initMessage = JSON.stringify({
		type: 'init', projectPath: process.cwd(), sessionId, provider: 'codex',
	});

	const firstSocket = createFakeSocket();
	handleShellConnection(firstSocket as never, dependencies as never);
	firstSocket.emit('message', initMessage);
	await new Promise((resolve) => setImmediate(resolve));
	firstSocket.emit('close');

	strictMode = true;
	const secondSocket = createFakeSocket();
	handleShellConnection(secondSocket as never, dependencies as never);
	secondSocket.emit('message', initMessage);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(spawnCount, 2);
	assert.equal(secondSocket.frames.some((frame) => frame.includes('Reconnected')), false);
	firstPty.emitExit();
	secondPty.emitExit();
});
