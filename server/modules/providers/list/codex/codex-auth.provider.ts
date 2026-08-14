import spawn from "cross-spawn";

import type { IProviderAuth } from "@/shared/interfaces.js";
import type { ProviderAuthStatus } from "@/shared/types.js";

export class CodexProviderAuth implements IProviderAuth {
	/**
	 * Checks whether Codex is available to the server runtime.
	 */
	private checkInstalled(): boolean {
		try {
			spawn.sync("codex", ["--version"], { stdio: "ignore", timeout: 5000 });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Reports only whether the Codex executable exists. OAuth credentials are
	 * owned by 9Router and are never read from the local Codex auth file.
	 */
	async getStatus(): Promise<ProviderAuthStatus> {
		return {
			installed: this.checkInstalled(),
			provider: "codex",
			authenticated: false,
			email: null,
			method: null,
		};
	}
}
