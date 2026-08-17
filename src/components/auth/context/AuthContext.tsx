import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

import { IS_PLATFORM } from "../../../constants/config";
import {
	api,
	AUTH_SESSION_EXPIRED_EVENT,
	AUTH_TOKEN_REFRESHED_EVENT,
	getAuthTokenRefreshDelay,
	isValidRefreshedToken,
	storeAuthToken,
} from "../../../utils/api";
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from "../constants";
import type {
	AuthContextValue,
	AuthProviderProps,
	AuthSessionPayload,
	AuthStatusPayload,
	AuthUser,
	AuthUserPayload,
} from "../types";
import { parseJsonSafely, resolveApiErrorMessage } from "../utils";

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null =>
	localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
	storeAuthToken(token);
};

const clearStoredToken = () => {
	localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}

	return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [token, setToken] = useState<string | null>(() => readStoredToken());
	const [isLoading, setIsLoading] = useState(true);
	const [needsSetup, setNeedsSetup] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
		setUser(nextUser);
		setToken(nextToken);
		persistToken(nextToken);
	}, []);

	const clearSession = useCallback(() => {
		setUser(null);
		setToken(null);
		clearStoredToken();
	}, []);

	const refreshSession = useCallback(async () => {
		if (IS_PLATFORM || !token || !user) {
			return;
		}

		try {
			const response = await api.auth.refresh();
			if (!response.ok) {
				return;
			}

			const payload = await parseJsonSafely<AuthSessionPayload>(response);
			if (isValidRefreshedToken(payload?.token)) {
				setToken(payload.token);
				persistToken(payload.token);
			}
		} catch (caughtError) {
			// A transient network failure must not sign the user out. Focus/visibility
			// and the next scheduled refresh will retry while the token remains valid.
			console.warn("[Auth] Session refresh failed:", caughtError);
		}
	}, [token, user]);

	useEffect(() => {
		const handleTokenRefreshed = (event: Event) => {
			const nextToken = (event as CustomEvent<unknown>).detail;
			if (isValidRefreshedToken(nextToken)) {
				setToken(nextToken);
			}
		};
		const handleSessionExpired = () => {
			clearSession();
			setError(AUTH_ERROR_MESSAGES.sessionExpired);
		};

		window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
		window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
		return () => {
			window.removeEventListener(
				AUTH_TOKEN_REFRESHED_EVENT,
				handleTokenRefreshed,
			);
			window.removeEventListener(
				AUTH_SESSION_EXPIRED_EVENT,
				handleSessionExpired,
			);
		};
	}, [clearSession]);

	const checkAuthStatus = useCallback(async () => {
		try {
			setIsLoading(true);
			setError(null);

			const statusResponse = await api.auth.status();
			const statusPayload =
				await parseJsonSafely<AuthStatusPayload>(statusResponse);

			if (statusPayload?.needsSetup) {
				setNeedsSetup(true);
				return;
			}

			setNeedsSetup(false);

			if (!token) {
				return;
			}

			const userResponse = await api.auth.user();
			if (!userResponse.ok) {
				clearSession();
				return;
			}

			const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
			if (!userPayload?.user) {
				clearSession();
				return;
			}

			setUser(userPayload.user);
		} catch (caughtError) {
			console.error("[Auth] Auth status check failed:", caughtError);
			setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
		} finally {
			setIsLoading(false);
		}
	}, [clearSession, token]);

	useEffect(() => {
		if (IS_PLATFORM) {
			setUser({ username: "platform-user" });
			setNeedsSetup(false);
			setIsLoading(false);
			return;
		}

		void checkAuthStatus();
	}, [checkAuthStatus]);

	useEffect(() => {
		if (IS_PLATFORM || !token || !user) {
			return undefined;
		}

		const refreshIfNeeded = () => {
			const refreshDelay = getAuthTokenRefreshDelay(token);
			if (refreshDelay !== null && refreshDelay <= 0) {
				void refreshSession();
			}
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				refreshIfNeeded();
			}
		};

		const refreshDelay = getAuthTokenRefreshDelay(token);
		const refreshTimer =
			refreshDelay === null
				? null
				: window.setTimeout(() => void refreshSession(), refreshDelay);

		window.addEventListener("focus", refreshIfNeeded);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			if (refreshTimer !== null) {
				window.clearTimeout(refreshTimer);
			}
			window.removeEventListener("focus", refreshIfNeeded);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [refreshSession, token, user]);

	const login = useCallback<AuthContextValue["login"]>(
		async (username, password) => {
			try {
				setError(null);
				const response = await api.auth.login(username, password);
				const payload = await parseJsonSafely<AuthSessionPayload>(response);

				if (!response.ok || !payload?.token || !payload.user) {
					const message = resolveApiErrorMessage(
						payload,
						AUTH_ERROR_MESSAGES.loginFailed,
					);
					setError(message);
					return { success: false, error: message };
				}

				setSession(payload.user, payload.token);
				setNeedsSetup(false);
				return { success: true };
			} catch (caughtError) {
				console.error("Login error:", caughtError);
				setError(AUTH_ERROR_MESSAGES.networkError);
				return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
			}
		},
		[setSession],
	);

	const register = useCallback<AuthContextValue["register"]>(
		async (username, password) => {
			try {
				setError(null);
				const response = await api.auth.register(username, password);
				const payload = await parseJsonSafely<AuthSessionPayload>(response);

				if (!response.ok || !payload?.token || !payload.user) {
					const message = resolveApiErrorMessage(
						payload,
						AUTH_ERROR_MESSAGES.registrationFailed,
					);
					setError(message);
					return { success: false, error: message };
				}

				setSession(payload.user, payload.token);
				setNeedsSetup(false);
				return { success: true };
			} catch (caughtError) {
				console.error("Registration error:", caughtError);
				setError(AUTH_ERROR_MESSAGES.networkError);
				return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
			}
		},
		[setSession],
	);

	const logout = useCallback(() => {
		// JWT logout is client-side: the server endpoint does not maintain a
		// revocation list, so clearing the session is the complete operation.
		clearSession();
	}, [clearSession]);

	const contextValue = useMemo<AuthContextValue>(
		() => ({
			user,
			token,
			isLoading,
			needsSetup,
			error,
			login,
			register,
			logout,
		}),
		[error, isLoading, login, logout, needsSetup, register, token, user],
	);

	return (
		<AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
	);
}
