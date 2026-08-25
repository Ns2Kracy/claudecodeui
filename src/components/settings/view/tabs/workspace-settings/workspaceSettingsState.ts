export type WorkspaceSettingsState = {
  strictIsolation: boolean;
  isolationAvailable: boolean;
  isolationReason: string | null;
};

export const EMPTY_WORKSPACE_SETTINGS: WorkspaceSettingsState = {
  strictIsolation: true,
  isolationAvailable: false,
  isolationReason: null,
};

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettingsState {
  if (!value || typeof value !== 'object') return EMPTY_WORKSPACE_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    strictIsolation: typeof record.strictIsolation === 'boolean' ? record.strictIsolation : true,
    isolationAvailable: record.isolationAvailable === true,
    isolationReason: typeof record.isolationReason === 'string' ? record.isolationReason : null,
  };
}
