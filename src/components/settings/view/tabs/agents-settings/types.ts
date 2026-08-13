import type { ComponentType } from "react";

import type {
	AgentCategory,
	CodexPermissionMode,
	SettingsProject,
} from "../../../types/types";

export type AgentsSettingsTabProps = {
	codexPermissionMode: CodexPermissionMode;
	onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
	projects: SettingsProject[];
};

export type AgentCategoryTabsSectionProps = {
	categories: AgentCategory[];
	selectedCategory: AgentCategory;
	onSelectCategory: (category: AgentCategory) => void;
};

export type AgentCategoryContentSectionProps = {
	selectedCategory: AgentCategory;
	ProviderAccountsManagerComponent?: ComponentType;
	codexPermissionMode: CodexPermissionMode;
	onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
	projects: SettingsProject[];
};
