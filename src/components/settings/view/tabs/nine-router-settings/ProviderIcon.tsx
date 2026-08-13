import { Braces } from "lucide-react";

import CodexLogo from "../../../../llm-logo-provider/CodexLogo.js";

import type { NineRouterProviderIcon } from "./ProviderCatalog.js";

type ProviderIconProps = {
	icon: NineRouterProviderIcon;
	label: string;
	className?: string;
};

const BRAND_ICON_PATHS: Partial<Record<NineRouterProviderIcon, string>> = {
	openai: "/icons/providers/openai.svg",
	anthropic: "/icons/providers/anthropic.svg",
	gemini: "/icons/providers/gemini.svg",
	deepseek: "/icons/providers/deepseek.svg",
	openrouter: "/icons/providers/openrouter.svg",
};

/** Renders local provider marks without loading third-party assets. */
export default function ProviderIcon({
	icon,
	label,
	className = "h-5 w-5",
}: ProviderIconProps) {
	if (icon === "codex") {
		return <CodexLogo className={className} />;
	}

	const path = BRAND_ICON_PATHS[icon];
	if (path) {
		return (
			<img
				src={path}
				alt=""
				role="img"
				aria-label={label}
				className={`${className} object-contain dark:invert`}
			/>
		);
	}

	return <Braces role="img" aria-label={label} className={className} />;
}
