import React, { useState } from 'react';
import { Check, Loader2, Pencil, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RoutingConnectionView } from '../../../../../../shared/routing.js';
import { Badge, Button, Input } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

import type { RoutingConnectionDraft } from './routingState.js';

type ConnectionSectionProps = {
  connection: RoutingConnectionView;
  draft: RoutingConnectionDraft;
  activeMutation: string | null;
  onFieldChange: (field: keyof RoutingConnectionDraft, value: string) => void;
  onCancelEdit: () => void;
  onConnect: () => Promise<boolean>;
  onValidate: () => void;
  onDisconnect: () => void;
};

const statusTone: Record<RoutingConnectionView['status'], string> = {
  disconnected: 'border-border bg-muted text-muted-foreground',
  checking: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  connected: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  degraded: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  offline: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export default function ConnectionSection({
  connection,
  draft,
  activeMutation,
  onFieldChange,
  onCancelEdit,
  onConnect,
  onValidate,
  onDisconnect,
}: ConnectionSectionProps) {
  const { t } = useTranslation('settings');
  const [editing, setEditing] = useState(false);
  const saving = activeMutation === 'connection:save';
  const checking = activeMutation === 'connection:test';
  const disconnecting = activeMutation === 'connection:disconnect';
  const isBusy = saving || checking || disconnecting;
  const canConnect = Boolean(
    draft.baseUrl.trim()
      && (connection.hasAdminCredential || draft.adminPassword)
      && (connection.hasDataPlaneKey || draft.dataPlaneKey)
      && connection.secureStorageAvailable,
  );

  const handleConnect = async () => {
    if (await onConnect()) setEditing(false);
  };

  const fields = (
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <label htmlFor="nine-router-endpoint" className="text-sm font-medium text-foreground">
          {t('nineRouter.connection.endpoint')}
        </label>
        <Input
          id="nine-router-endpoint"
          type="url"
          inputMode="url"
          autoComplete="url"
          value={draft.baseUrl}
          placeholder="https://router.example"
          onChange={(event) => onFieldChange('baseUrl', event.target.value)}
          disabled={isBusy}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('nineRouter.connection.endpointHelp')}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="nine-router-admin-password" className="text-sm font-medium text-foreground">
            {t('nineRouter.connection.adminPassword')}
          </label>
          {connection.hasAdminCredential && (
            <span className="text-xs text-muted-foreground">{t('nineRouter.connection.configured')}</span>
          )}
        </div>
        <Input
          id="nine-router-admin-password"
          type="password"
          autoComplete="new-password"
          value={draft.adminPassword}
          placeholder={connection.hasAdminCredential ? t('nineRouter.connection.keepConfigured') : ''}
          onChange={(event) => onFieldChange('adminPassword', event.target.value)}
          disabled={isBusy}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="nine-router-data-key" className="text-sm font-medium text-foreground">
            {t('nineRouter.connection.dataPlaneKey')}
          </label>
          {connection.hasDataPlaneKey && (
            <span className="text-xs text-muted-foreground">{t('nineRouter.connection.configured')}</span>
          )}
        </div>
        <Input
          id="nine-router-data-key"
          type="password"
          autoComplete="off"
          value={draft.dataPlaneKey}
          placeholder={connection.hasDataPlaneKey ? t('nineRouter.connection.keepConfigured') : ''}
          onChange={(event) => onFieldChange('dataPlaneKey', event.target.value)}
          disabled={isBusy}
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
        {t('nineRouter.connection.writeOnlyHelp')}
      </p>
    </div>
  );

  return (
    <SettingsSection
      title={t('nineRouter.connection.title')}
      description={t('nineRouter.connection.description')}
    >
      <SettingsCard>
        {!connection.configured ? (
          <>
            {fields}
            <div className="flex justify-end border-t border-border p-4">
              <Button
                type="button"
                onClick={() => { void handleConnect(); }}
                disabled={!canConnect || isBusy}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                {saving
                  ? t('nineRouter.connection.actions.connecting')
                  : t('nineRouter.connection.actions.connect')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={statusTone[connection.status]}>
                    {connection.status === 'connected' && <Check className="mr-1 h-3 w-3" />}
                    {t(`nineRouter.connection.status.${connection.status}`)}
                  </Badge>
                  <span className="break-all text-sm font-medium text-foreground">
                    {connection.baseUrl}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t('nineRouter.connection.version')}: {connection.version || t('nineRouter.connection.unknown')}
                  </span>
                  <span>
                    {t('nineRouter.connection.lastChecked')}: {connection.lastCheckedAt || t('nineRouter.connection.never')}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onValidate} disabled={isBusy}>
                  {checking && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                  {!checking && <RefreshCw className="h-4 w-4" />}
                  {t('nineRouter.connection.actions.test')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (editing) onCancelEdit();
                    setEditing((current) => !current);
                  }}
                  disabled={isBusy}
                >
                  <Pencil className="h-4 w-4" />
                  {editing
                    ? t('nineRouter.connection.actions.cancelEdit')
                    : t('nineRouter.connection.actions.edit')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onDisconnect} disabled={isBusy}>
                  {disconnecting
                    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    : <Unplug className="h-4 w-4" />}
                  {t('nineRouter.connection.actions.disconnect')}
                </Button>
              </div>
            </div>

            {editing && (
              <div className="border-t border-border">
                {fields}
                <div className="flex justify-end border-t border-border p-4">
                  <Button
                    type="button"
                    onClick={() => { void handleConnect(); }}
                    disabled={!canConnect || isBusy}
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                    {t('nineRouter.connection.actions.save')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
