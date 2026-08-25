import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pty, { type IPty } from "node-pty";
import { WebSocket, type RawData } from "ws";

import type { RuntimeRoutingConfiguration } from "@/shared/types.js";
import { parseIncomingJsonObject } from "@/shared/utils.js";

type ShellIncomingMessage = {
	type?: string;
	data?: string;
	cols?: number;
	rows?: number;
	projectPath?: string;
	sessionId?: string;
	hasSession?: boolean;
	provider?: string;
	initialCommand?: string;
	isPlainShell?: boolean;
	forceRestart?: boolean;
};

type PtySessionEntry = {
	pty: IPty;
	ws: WebSocket | null;
	buffer: string[];
	timeoutId: NodeJS.Timeout | null;
	projectPath: string;
	sessionId: string | null;
	isPlainShell: boolean;
};

const ptySessionsMap = new Map<string, PtySessionEntry>();
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;

/** Settings uses this after a workspace-policy update so retained Codex PTYs cannot keep older access. */
export function terminateRetainedAgentShellSessions(): void {
	for (const [sessionKey, session] of ptySessionsMap) {
		if (session.isPlainShell) continue;
		if (session.timeoutId) clearTimeout(session.timeoutId);
		session.pty.kill();
		ptySessionsMap.delete(sessionKey);
	}
}
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;
const ANSI_ESCAPE_SEQUENCE_REGEX =
	/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]}>.,;:!?]+$/;

function stripAnsiSequences(value: string): string {
	return value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, "");
}

function normalizeDetectedUrl(url: string): string | null {
	const cleanedUrl = url.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, "");
	if (!cleanedUrl) {
		return null;
	}

	try {
		const parsedUrl = new URL(cleanedUrl);
		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			return null;
		}
		return parsedUrl.toString();
	} catch {
		return null;
	}
}

function extractUrlsFromText(value: string): string[] {
	const directMatches = value.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi) ?? [];

	// Terminal width can split a URL across lines, so valid URL characters on
	// immediately following lines are joined before the URL is validated.
	const wrappedMatches: string[] = [];
	const urlContinuationPattern = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/;
	const lines = value.split(/\r?\n/);
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex].trim();
		const startMatch = line.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/i);
		if (!startMatch) {
			continue;
		}

		let combinedUrl = startMatch[0];
		let continuationIndex = lineIndex + 1;
		while (continuationIndex < lines.length) {
			const continuation = lines[continuationIndex].trim();
			if (!continuation || !urlContinuationPattern.test(continuation)) {
				break;
			}
			combinedUrl += continuation;
			continuationIndex += 1;
		}

		wrappedMatches.push(combinedUrl);
	}

	return Array.from(new Set([...directMatches, ...wrappedMatches]));
}

function shouldAutoOpenUrlFromOutput(value: string): boolean {
	const normalizedOutput = value.toLowerCase();
	return (
		normalizedOutput.includes("browser didn't open") ||
		normalizedOutput.includes("open this url") ||
		normalizedOutput.includes("continue in your browser") ||
		normalizedOutput.includes("press enter to open") ||
		normalizedOutput.includes("open_url:")
	);
}

type CodexShellRouting = Extract<
	RuntimeRoutingConfiguration,
	{ source: "9router" }
>;

type WorkspaceLaunch = {
	workingDirectory: string;
	codexPathOverride?: string;
	replaceEnvironment?: boolean;
	environment: Record<string, string>;
};

type ShellWebSocketDependencies = {
	resolveProviderSessionId: (
		sessionId: string,
		provider: string,
	) => string | null | undefined;
	resolveCodexShellRouting: (
		sessionId: string | null,
	) => Promise<CodexShellRouting>;
	resolveWorkspaceLaunch?: (projectPath: string) => Promise<WorkspaceLaunch>;
	spawnPty?: typeof pty.spawn;
};

/**
 * Reads a string field from untyped payloads and falls back when absent.
 */
function readString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/**
 * Reads a boolean field from untyped payloads and falls back when absent.
 */
function readBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a finite number field from untyped payloads and falls back when absent.
 */
function readNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Parses incoming websocket shell messages and keeps processing safe when
 * malformed payloads are received.
 */
function parseShellMessage(rawMessage: RawData): ShellIncomingMessage | null {
	const payload = parseIncomingJsonObject(rawMessage);
	if (!payload) {
		return null;
	}

	return payload as ShellIncomingMessage;
}

const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_.\-:]+$/;

function resolveResumeSessionId(
	message: ShellIncomingMessage,
	dependencies: ShellWebSocketDependencies,
): string {
	const hasSession = readBoolean(message.hasSession);
	const sessionId = readString(message.sessionId);
	const provider = "codex";

	if (!hasSession || !sessionId) {
		return "";
	}

	let resumeSessionId: string | null | undefined;
	try {
		resumeSessionId = dependencies.resolveProviderSessionId(sessionId, provider);
	} catch (error) {
		console.error("Failed to resolve provider session ID:", error);
		resumeSessionId = undefined;
	}

	const resolvedSessionId =
		resumeSessionId === undefined ? sessionId : resumeSessionId;
	if (!resolvedSessionId || !SAFE_SESSION_ID_PATTERN.test(resolvedSessionId)) {
		return "";
	}

	return resolvedSessionId;
}

/**
 * Builds a static shell command whose dynamic values are read from quoted
 * process-local environment variables. The shell wrapper preserves npm/PATHEXT
 * command resolution on Windows without exposing credentials in arguments.
 */
function buildCodexShellCommand(
	resumeSessionId: string,
	useWorkspaceWrapper = false,
): string {
	if (os.platform() === "win32") {
		const command =
			'codex --config "openai_base_url=$env:CLOUDCLI_CODEX_BASE_URL" --model "$env:CLOUDCLI_CODEX_MODEL"';
		return resumeSessionId
			? `${command} resume "$env:CLOUDCLI_CODEX_RESUME_ID"; if ($LASTEXITCODE -ne 0) { ${command} }`
			: command;
	}

	const executable = useWorkspaceWrapper
		? '"$CLOUDCLI_CODEX_WRAPPER"'
		: 'codex';
	const command =
		`${executable} --config "openai_base_url=$CLOUDCLI_CODEX_BASE_URL" --model "$CLOUDCLI_CODEX_MODEL"`;
	return resumeSessionId
		? `${command} resume "$CLOUDCLI_CODEX_RESUME_ID" || ${command}`
		: command;
}

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
	const resolvedKey = Object.keys(env).find(
		(envKey) => envKey.toLowerCase() === key.toLowerCase(),
	);
	return resolvedKey ? env[resolvedKey] : undefined;
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
	return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function prioritizeUserNpmGlobalBin(env: NodeJS.ProcessEnv): {
	key: string;
	value: string | undefined;
} {
	const pathKey = getPathEnvKey(env);
	const currentPath = env[pathKey];
	if (!currentPath) {
		return { key: pathKey, value: currentPath };
	}

	const delimiter = path.delimiter;
	const pathEntries = currentPath.split(delimiter).filter(Boolean);
	const npmPrefix = readEnvValue(env, "npm_config_prefix");
	const appData = readEnvValue(env, "APPDATA");
	const candidates = [
		npmPrefix || "",
		npmPrefix ? path.join(npmPrefix, "bin") : "",
		appData ? path.join(appData, "npm") : "",
		path.join(os.homedir(), "AppData", "Roaming", "npm"),
		path.join(os.homedir(), ".npm-global", "bin"),
	].filter(Boolean);

	const normalizedPathEntries = pathEntries.map((entry) =>
		os.platform() === "win32" ? entry.toLowerCase() : entry,
	);
	const preferredEntries = candidates.filter((candidate, index) => {
		const normalizedCandidate =
			os.platform() === "win32" ? candidate.toLowerCase() : candidate;
		return (
			candidates.indexOf(candidate) === index &&
			normalizedPathEntries.includes(normalizedCandidate)
		);
	});

	if (preferredEntries.length === 0) {
		return { key: pathKey, value: currentPath };
	}

	const normalizedPreferredEntries = preferredEntries.map((entry) =>
		os.platform() === "win32" ? entry.toLowerCase() : entry,
	);

	const value = [
		...preferredEntries,
		...pathEntries.filter((entry) => {
			const normalizedEntry =
				os.platform() === "win32" ? entry.toLowerCase() : entry;
			return !normalizedPreferredEntries.includes(normalizedEntry);
		}),
	].join(delimiter);

	return { key: pathKey, value };
}

/**
 * Used by this module's websocket gateway to connect the standalone Shell UI
 * to a retained PTY while keeping process lifecycle ownership on the server.
 */
export function handleShellConnection(
	ws: WebSocket,
	dependencies: ShellWebSocketDependencies,
): void {
	console.log("[INFO] Shell websocket connected");

	let shellProcess: IPty | null = null;
	let ptySessionKey: string | null = null;
	let initializationPending = false;
	let socketClosed = false;
	let urlDetectionBuffer = "";
	const announcedAuthUrls = new Set<string>();

	ws.on("message", async (rawMessage) => {
		try {
			const data = parseShellMessage(rawMessage);
			if (!data?.type) {
				throw new Error("Invalid websocket payload");
			}

			if (data.type === "init") {
				if (initializationPending || shellProcess) {
					return;
				}
				initializationPending = true;
				const projectPath = readString(data.projectPath, process.cwd());
				const sessionId = readString(data.sessionId) || null;
				const hasSession = readBoolean(data.hasSession);
				const provider = readString(data.provider, "codex");
				const initialCommand = readString(data.initialCommand);
				const forceRestart = readBoolean(data.forceRestart);
				const isPlainShell =
					readBoolean(data.isPlainShell) ||
					(!!initialCommand && !hasSession) ||
					provider === "plain-shell";

				urlDetectionBuffer = "";
				announcedAuthUrls.clear();

				const isLoginCommand =
					!!initialCommand && initialCommand.includes("auth login");

				let resolvedProjectPath = path.resolve(projectPath);
				let workspaceLaunch: WorkspaceLaunch | null = null;
				try {
					const stats = fs.statSync(resolvedProjectPath);
					if (!stats.isDirectory()) {
						throw new Error("Not a directory");
					}
					if (dependencies.resolveWorkspaceLaunch) {
						workspaceLaunch = await dependencies.resolveWorkspaceLaunch(
							resolvedProjectPath,
						);
						resolvedProjectPath = workspaceLaunch.workingDirectory;
					}
				} catch {
					ws.send(
						JSON.stringify({ type: "error", message: "Invalid project path" }),
					);
					initializationPending = false;
					return;
				}

				const commandSuffix =
					isPlainShell && initialCommand
						? `_cmd_${Buffer.from(initialCommand).toString("base64").slice(0, 16)}`
						: "";
				const workspacePolicyKey = workspaceLaunch
					? JSON.stringify({
						root: workspaceLaunch.environment.CLOUDCLI_WORKSPACE_ROOT || "",
						wrapper: workspaceLaunch.codexPathOverride || "",
					})
					: "plain-shell";
				const currentPtySessionKey = `${resolvedProjectPath}_${sessionId ?? "default"}${commandSuffix}_${workspacePolicyKey}`;

				if (isLoginCommand || forceRestart) {
					const oldSession = ptySessionsMap.get(currentPtySessionKey);
					if (oldSession) {
						if (oldSession.timeoutId) {
							clearTimeout(oldSession.timeoutId);
						}
						oldSession.pty.kill();
						ptySessionsMap.delete(currentPtySessionKey);
					}
				}

				const existingSession =
					isLoginCommand || forceRestart
						? null
						: ptySessionsMap.get(currentPtySessionKey);
				if (existingSession) {
					shellProcess = existingSession.pty;
					if (existingSession.timeoutId) {
						clearTimeout(existingSession.timeoutId);
						existingSession.timeoutId = null;
					}

					ws.send(
						JSON.stringify({
							type: "output",
							data: "\x1b[36m[Reconnected to existing session]\x1b[0m\r\n",
						}),
					);

					if (existingSession.buffer.length > 0) {
						existingSession.buffer.forEach((bufferedData) => {
							ws.send(
								JSON.stringify({
									type: "output",
									data: bufferedData,
								}),
							);
						});
					}

					existingSession.ws = ws;
					ptySessionKey = currentPtySessionKey;
					initializationPending = false;
					return;
				}

				const safeSessionIdPattern = /^[a-zA-Z0-9_.\-:]+$/;
				if (sessionId && !safeSessionIdPattern.test(sessionId)) {
					ws.send(JSON.stringify({ type: "error", message: "Invalid session ID" }));
					initializationPending = false;
					return;
				}

				const resumeSessionId = resolveResumeSessionId(data, dependencies);
				const termCols = readNumber(data.cols, 80);
				const termRows = readNumber(data.rows, 24);
				const prioritizedPath = prioritizeUserNpmGlobalBin(process.env);
				let executable: string;
				let executableArgs: string[];
				let codexRouting: CodexShellRouting | null = null;

				if (isPlainShell) {
					const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
					executable = shell;
					executableArgs =
						os.platform() === "win32"
							? ["-Command", initialCommand]
							: ["-c", initialCommand];
				} else {
					const routing = await dependencies.resolveCodexShellRouting(sessionId);
					if (socketClosed || ws.readyState !== WebSocket.OPEN) {
						initializationPending = false;
						return;
					}
					if (
						!routing.apiKey.trim() ||
						!routing.openAiBaseUrl.trim() ||
						!routing.routeName.trim()
					) {
						throw new Error("Codex routing credentials are unavailable");
					}
					executable = os.platform() === "win32" ? "powershell.exe" : "bash";
					const codexCommand = buildCodexShellCommand(
						resumeSessionId,
						Boolean(workspaceLaunch?.codexPathOverride),
					);
					executableArgs =
						os.platform() === "win32"
							? ["-Command", codexCommand]
							: ["-c", codexCommand];
					codexRouting = routing;
				}

				const shellEnvironment: NodeJS.ProcessEnv = {
					...(workspaceLaunch?.replaceEnvironment ? {} : process.env),
					...workspaceLaunch?.environment,
					[prioritizedPath.key]: prioritizedPath.value,
					TERM: "xterm-256color",
					COLORTERM: "truecolor",
					FORCE_COLOR: "3",
				};
				if (codexRouting) {
					if (workspaceLaunch?.codexPathOverride) {
						shellEnvironment.CLOUDCLI_CODEX_WRAPPER =
							workspaceLaunch.codexPathOverride;
					}
					shellEnvironment.CODEX_API_KEY = codexRouting.apiKey;
					shellEnvironment.CLOUDCLI_CODEX_BASE_URL = codexRouting.openAiBaseUrl;
					shellEnvironment.CLOUDCLI_CODEX_MODEL = codexRouting.routeName;
					if (resumeSessionId) {
						shellEnvironment.CLOUDCLI_CODEX_RESUME_ID = resumeSessionId;
					}
				}

				const spawnedProcess = (dependencies.spawnPty ?? pty.spawn)(
					executable,
					executableArgs,
					{
						name: "xterm-256color",
						cols: termCols,
						rows: termRows,
						cwd: resolvedProjectPath,
						env: shellEnvironment,
					},
				);
				shellProcess = spawnedProcess;

				ptySessionKey = currentPtySessionKey;
				ptySessionsMap.set(currentPtySessionKey, {
					pty: spawnedProcess,
					ws,
					buffer: [],
					timeoutId: null,
					projectPath: resolvedProjectPath,
					sessionId,
					isPlainShell,
				});
				initializationPending = false;

				spawnedProcess.onData((chunk) => {
					const session = ptySessionsMap.get(currentPtySessionKey);
					if (!session) {
						return;
					}

					if (session.buffer.length < 5000) {
						session.buffer.push(chunk);
					} else {
						session.buffer.shift();
						session.buffer.push(chunk);
					}

					if (session.ws && session.ws.readyState === WebSocket.OPEN) {
						let outputData = chunk;
						const cleanChunk = stripAnsiSequences(chunk);
						urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(
							-SHELL_URL_PARSE_BUFFER_LIMIT,
						);

						outputData = outputData.replace(
							/OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
							"[INFO] Opening in browser: $1",
						);

						const emitAuthUrl = (detectedUrl: string, autoOpen = false) => {
							const normalizedUrl = normalizeDetectedUrl(detectedUrl);
							if (!normalizedUrl) {
								return;
							}

							const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
							if (isNewUrl) {
								announcedAuthUrls.add(normalizedUrl);
								session.ws?.send(
									JSON.stringify({
										type: "auth_url",
										url: normalizedUrl,
										autoOpen,
									}),
								);
							}
						};

						const normalizedDetectedUrls = extractUrlsFromText(urlDetectionBuffer)
							.map((url) => normalizeDetectedUrl(url))
							.filter((url): url is string => Boolean(url));

						const dedupedDetectedUrls = Array.from(
							new Set(normalizedDetectedUrls),
						).filter(
							(url, _, urls) =>
								!urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url)),
						);

						dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

						if (
							shouldAutoOpenUrlFromOutput(cleanChunk) &&
							dedupedDetectedUrls.length > 0
						) {
							const bestUrl = dedupedDetectedUrls.reduce((longest, current) =>
								current.length > longest.length ? current : longest,
							);
							emitAuthUrl(bestUrl, true);
						}

						session.ws.send(
							JSON.stringify({
								type: "output",
								data: outputData,
							}),
						);
					}
				});

				spawnedProcess.onExit((exitCode) => {
					const session = ptySessionsMap.get(currentPtySessionKey);
					if (session && session.pty !== spawnedProcess) {
						return;
					}

					if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
						session.ws.send(
							JSON.stringify({
								type: "output",
								data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${
									exitCode.signal != null ? ` (${exitCode.signal})` : ""
								}\x1b[0m\r\n`,
							}),
						);
					}

					if (session?.timeoutId) {
						clearTimeout(session.timeoutId);
					}

					ptySessionsMap.delete(currentPtySessionKey);
					if (shellProcess === spawnedProcess) {
						shellProcess = null;
					}
				});

				let welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
				if (!isPlainShell) {
					welcomeMsg =
						hasSession && resumeSessionId
							? `\x1b[36mResuming Codex session ${resumeSessionId} in: ${projectPath}\x1b[0m\r\n`
							: `\x1b[36mStarting new Codex session in: ${projectPath}\x1b[0m\r\n`;
				}

				ws.send(
					JSON.stringify({
						type: "output",
						data: welcomeMsg,
					}),
				);
				return;
			}

			if (data.type === "input") {
				if (shellProcess) {
					shellProcess.write(readString(data.data));
				}
				return;
			}

			if (data.type === "resize") {
				if (shellProcess) {
					shellProcess.resize(readNumber(data.cols, 80), readNumber(data.rows, 24));
				}
			}
		} catch (error) {
			initializationPending = false;
			const message = error instanceof Error ? error.message : String(error);
			console.error("[ERROR] Shell WebSocket error:", message);
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(
					JSON.stringify({
						type: "output",
						data: `\r\n\x1b[31mError: ${message}\x1b[0m\r\n`,
					}),
				);
			}
		}
	});

	ws.on("close", () => {
		socketClosed = true;
		if (!ptySessionKey) {
			return;
		}

		const session = ptySessionsMap.get(ptySessionKey);
		if (!session) {
			return;
		}

		// Mobile networks can deliver an old socket's close after its replacement
		// has attached. Only the socket that currently owns the PTY may detach it.
		if (session.ws !== ws) {
			return;
		}

		session.ws = null;
		if (session.timeoutId) {
			clearTimeout(session.timeoutId);
		}
		session.timeoutId = setTimeout(() => {
			// A reconnect may win just as this timer becomes runnable. Re-check the
			// active socket so a queued cleanup can never kill a reattached PTY.
			if (
				ptySessionsMap.get(ptySessionKey as string) !== session ||
				session.ws !== null
			) {
				return;
			}

			session.pty.kill();
			ptySessionsMap.delete(ptySessionKey as string);
		}, PTY_SESSION_TIMEOUT);
	});

	ws.on("error", (error) => {
		console.error("[ERROR] Shell WebSocket error:", error);
	});
}
