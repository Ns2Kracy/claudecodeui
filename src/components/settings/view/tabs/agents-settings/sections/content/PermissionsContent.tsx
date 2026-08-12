import { AlertTriangle, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CodexPermissionMode } from "../../../../../types/types";

type PermissionsContentProps = {
	agent: "codex";
	permissionMode: CodexPermissionMode;
	onPermissionModeChange: (value: CodexPermissionMode) => void;
};

export default function PermissionsContent({
	permissionMode,
	onPermissionModeChange,
}: PermissionsContentProps) {
	const { t } = useTranslation("settings");

	const modes: Array<{
		value: CodexPermissionMode;
		activeClassName: string;
		inputClassName: string;
	}> = [
		{
			value: "default",
			activeClassName: "border-border bg-accent",
			inputClassName: "text-green-600",
		},
		{
			value: "acceptEdits",
			activeClassName:
				"border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20",
			inputClassName: "text-green-600",
		},
		{
			value: "bypassPermissions",
			activeClassName:
				"border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-900/20",
			inputClassName: "text-orange-600",
		},
	];

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<div className="flex items-center gap-3">
					<Shield className="h-5 w-5 text-green-500" />
					<h3 className="text-lg font-medium text-foreground">
						{t("permissions.codex.permissionMode")}
					</h3>
				</div>
				<p className="text-sm text-muted-foreground">
					{t("permissions.codex.description")}
				</p>

				{modes.map(({ value, activeClassName, inputClassName }) => {
					const isActive = permissionMode === value;
					return (
						<label
							key={value}
							className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all ${
								isActive
									? activeClassName
									: "border-border bg-card/50 active:border-border active:bg-accent/50"
							}`}
						>
							<input
								type="radio"
								name="codexPermissionMode"
								checked={isActive}
								onChange={() => onPermissionModeChange(value)}
								className={`mt-1 h-4 w-4 ${inputClassName}`}
							/>
							<div>
								<div className="flex items-center gap-2 font-medium text-foreground">
									{t(`permissions.codex.modes.${value}.title`)}
									{value === "bypassPermissions" && (
										<AlertTriangle className="h-4 w-4" />
									)}
								</div>
								<div className="text-sm text-muted-foreground">
									{t(`permissions.codex.modes.${value}.description`)}
								</div>
							</div>
						</label>
					);
				})}

				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
						{t("permissions.codex.technicalDetails")}
					</summary>
					<div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
						{modes.map(({ value }) => (
							<p key={value}>
								<strong>{t(`permissions.codex.modes.${value}.title`)}:</strong>{" "}
								{t(`permissions.codex.technicalInfo.${value}`)}
							</p>
						))}
						<p className="text-xs opacity-75">
							{t("permissions.codex.technicalInfo.overrideNote")}
						</p>
					</div>
				</details>
			</div>
		</div>
	);
}
