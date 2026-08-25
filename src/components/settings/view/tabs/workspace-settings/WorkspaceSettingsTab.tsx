import { AlertTriangle, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../../utils/api';
import { Button } from '../../../../../shared/view/ui';
import SettingsSection from '../../SettingsSection';

import {
  EMPTY_WORKSPACE_SETTINGS,
  normalizeWorkspaceSettings,
  type WorkspaceSettingsState,
} from './workspaceSettingsState';

type RequestStatus = 'idle' | 'loading' | 'saving' | 'success' | 'error';

const protectionModes = [
  {
    value: true,
    activeClassName: 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20',
    inputClassName: 'text-green-600',
  },
  {
    value: false,
    activeClassName: 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20',
    inputClassName: 'text-amber-600',
  },
] as const;

export default function WorkspaceSettingsTab() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<WorkspaceSettingsState>(EMPTY_WORKSPACE_SETTINGS);
  const [status, setStatus] = useState<RequestStatus>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authenticatedFetch('/api/settings/workspace')
      .then(async (response) => {
        if (!response.ok) throw new Error(t('workspace.errors.load'));
        const data = normalizeWorkspaceSettings(await response.json());
        if (active) {
          setSettings(data);
          setStatus('idle');
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t('workspace.errors.load'));
          setStatus('error');
        }
      });
    return () => { active = false; };
  }, [t]);

  const save = async () => {
    setStatus('saving');
    setError('');
    try {
      const response = await authenticatedFetch('/api/settings/workspace', {
        method: 'PUT',
        body: JSON.stringify({ strictIsolation: settings.strictIsolation }),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        const nestedError = body.error && typeof body.error === 'object'
          ? (body.error as Record<string, unknown>).message
          : null;
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : typeof nestedError === 'string'
              ? nestedError
              : t('workspace.errors.save'),
        );
      }
      setSettings(normalizeWorkspaceSettings(body));
      setStatus('success');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : t('workspace.errors.save'));
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('workspace.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={t('workspace.title')} description={t('workspace.description')}>
        <div className="space-y-3">
          {protectionModes.map(({ value, activeClassName, inputClassName }) => {
            const isActive = settings.strictIsolation === value;
            const isUnavailable = value && !settings.isolationAvailable;
            const mode = value ? 'protected' : 'unprotected';
            return (
              <label
                key={mode}
                className={`flex items-start gap-3 rounded-lg border p-4 transition-all ${
                  isActive
                    ? activeClassName
                    : 'border-border bg-card/50 active:border-border active:bg-accent/50'
                } ${isUnavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name="workspaceProtection"
                  checked={isActive}
                  disabled={isUnavailable}
                  onChange={() => setSettings((current) => ({ ...current, strictIsolation: value }))}
                  className={`mt-1 h-4 w-4 ${inputClassName}`}
                />
                <div>
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    {t(`workspace.protection.modes.${mode}.title`)}
                    {value ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{t(`workspace.protection.modes.${mode}.description`)}</p>
                </div>
              </label>
            );
          })}
          {!settings.isolationAvailable && (
            <p role="alert" className="text-sm text-destructive">
              {settings.isolationReason || t('workspace.protection.unavailable')}
            </p>
          )}
        </div>
      </SettingsSection>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {status === 'success' && <span className="text-sm text-muted-foreground">{t('workspace.saved')}</span>}
        <Button
          onClick={save}
          disabled={status === 'saving' || (settings.strictIsolation && !settings.isolationAvailable)}
        >
          {status === 'saving' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t('workspace.save')}
        </Button>
      </div>
    </div>
  );
}
