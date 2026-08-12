import type { LLMProvider } from "../../types/app";

import CodexLogo from "./CodexLogo";

type SessionProviderLogoProps = {
	provider?: LLMProvider | string | null;
	className?: string;
};

export default function SessionProviderLogo({
	className = "w-5 h-5",
}: SessionProviderLogoProps) {
	return <CodexLogo className={className} />;
}
