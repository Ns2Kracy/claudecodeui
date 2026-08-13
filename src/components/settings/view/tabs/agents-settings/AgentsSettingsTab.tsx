import { useEffect, useMemo, useState } from "react";

import type { AgentCategory } from "../../../types/types";

import type { AgentsSettingsTabProps } from "./types";
import AgentCategoryContentSection from "./sections/AgentCategoryContentSection";
import AgentCategoryTabsSection from "./sections/AgentCategoryTabsSection";

export default function AgentsSettingsTab({
	codexPermissionMode,
	onCodexPermissionModeChange,
	projects,
}: AgentsSettingsTabProps) {
	const [selectedCategory, setSelectedCategory] =
		useState<AgentCategory>("account");
	const visibleCategories = useMemo<AgentCategory[]>(
		() => ["account", "permissions", "mcp", "skills"],
		[],
	);

	useEffect(() => {
		if (!visibleCategories.includes(selectedCategory)) {
			setSelectedCategory(visibleCategories[0] ?? "account");
		}
	}, [selectedCategory, visibleCategories]);

	return (
		<div className="-mx-4 -mb-4 -mt-2 flex min-h-[300px] min-w-0 flex-col overflow-hidden md:-mx-6 md:-mb-6 md:-mt-2 md:min-h-[500px]">
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<AgentCategoryTabsSection
					categories={visibleCategories}
					selectedCategory={selectedCategory}
					onSelectCategory={setSelectedCategory}
				/>

				<AgentCategoryContentSection
					selectedCategory={selectedCategory}
					codexPermissionMode={codexPermissionMode}
					onCodexPermissionModeChange={onCodexPermissionModeChange}
					projects={projects}
				/>
			</div>
		</div>
	);
}
