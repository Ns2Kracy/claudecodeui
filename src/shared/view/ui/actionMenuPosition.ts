import type { CSSProperties } from "react";

type ActionMenuPortalStyleInput = {
	triggerRect: Pick<DOMRect, "bottom" | "right" | "top">;
	viewportHeight: number;
	viewportWidth: number;
	estimatedHeight: number;
};

export function getActionMenuPortalStyle({
	triggerRect,
	viewportHeight,
	viewportWidth,
	estimatedHeight,
}: ActionMenuPortalStyleInput): CSSProperties {
	const menuWidth = 260;
	return {
		top:
			triggerRect.bottom + 6 + estimatedHeight <= viewportHeight - 8
				? triggerRect.bottom + 6
				: Math.max(8, triggerRect.top - estimatedHeight - 6),
		left: Math.max(
			8,
			Math.min(triggerRect.right - menuWidth, viewportWidth - menuWidth - 8),
		),
		// Settings.tsx uses z-index 9999. A body portal must sit above it.
		zIndex: 10_000,
	};
}
