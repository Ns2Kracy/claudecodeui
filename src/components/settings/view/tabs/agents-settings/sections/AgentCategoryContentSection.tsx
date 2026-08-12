import type { McpProject } from "../../../../../mcp/types";
import { McpServers } from "../../../../../mcp";
import type { SkillsProject } from "../../../../../skills/types";
import { ProviderSkills } from "../../../../../skills";
import type { AgentCategoryContentSectionProps } from "../types";

import AccountContent from "./content/AccountContent";
import PermissionsContent from "./content/PermissionsContent";

export default function AgentCategoryContentSection({
	selectedCategory,
	agentContextById,
	codexPermissionMode,
	onCodexPermissionModeChange,
	projects,
}: AgentCategoryContentSectionProps) {
	const agentContext = agentContextById.codex;

	return (
		<div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
			{selectedCategory === "account" && (
				<AccountContent
					agent="codex"
					authStatus={agentContext.authStatus}
					onLogin={agentContext.onLogin}
				/>
			)}

			{selectedCategory === "permissions" && (
				<PermissionsContent
					agent="codex"
					permissionMode={codexPermissionMode}
					onPermissionModeChange={onCodexPermissionModeChange}
				/>
			)}

			{selectedCategory === "mcp" && (
				<McpServers
					selectedProvider="codex"
					currentProjects={projects.map<McpProject>((project) => ({
						projectId: project.name,
						displayName: project.displayName,
						fullPath: project.fullPath,
						path: project.path,
					}))}
				/>
			)}

			{selectedCategory === "skills" && (
				<ProviderSkills
					selectedProvider="codex"
					currentProjects={projects.map<SkillsProject>((project) => ({
						projectId: project.name,
						displayName: project.displayName,
						fullPath: project.fullPath,
						path: project.path,
					}))}
				/>
			)}
		</div>
	);
}
