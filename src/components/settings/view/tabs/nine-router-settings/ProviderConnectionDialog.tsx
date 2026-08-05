import React, { useState } from 'react';
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';

import type { RoutingDeviceCodeChallengeView } from '../../../../../../shared/routing.js';
import { Button, Input } from '../../../../../shared/view/ui';

import CustomProviderEditor, { type CustomProviderDraft } from './CustomProviderEditor.js';
import OAuthDeviceFlow, { type OAuthDeviceFlowStatus } from './OAuthDeviceFlow.js';
import type { NineRouterProviderProfile } from './ProviderCatalog.js';

type ConnectionError = {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
};

type ProviderConnectionDialogProps = {
  profile: NineRouterProviderProfile;
  busy: boolean;
  error: ConnectionError | null;
  deviceChallenge: RoutingDeviceCodeChallengeView | null;
  deviceStatus: OAuthDeviceFlowStatus;
  onConnectApiKey: (provider: string, name: string, apiKey: string) => Promise<boolean>;
  onStartOAuth: (provider: string) => Promise<boolean>;
  onStartDeviceCode: (provider: string) => Promise<boolean>;
  onCancelDeviceCode: (provider: string, transactionId: string) => Promise<void>;
  onCreateCustomProvider: (draft: CustomProviderDraft) => Promise<boolean>;
};

export function isAllowedOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export default function ProviderConnectionDialog({
  profile,
  busy,
  error,
  deviceChallenge,
  deviceStatus,
  onConnectApiKey,
  onStartOAuth,
  onStartDeviceCode,
  onCancelDeviceCode,
  onCreateCustomProvider,
}: ProviderConnectionDialogProps) {
  const [name, setName] = useState(profile.name);
  const [apiKey, setApiKey] = useState('');
  const topologyError = error?.code === 'ROUTING_OAUTH_TOPOLOGY_UNSUPPORTED';

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">Connect {profile.name}</h4>
        <p className="mt-1 text-xs text-muted-foreground">Credentials are sent only to CloudCLI’s same-origin routing API.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-foreground">
            {topologyError ? 'This CloudCLI deployment cannot receive this provider’s browser callback.' : error.message}
          </p>
          {topologyError && profile.methods.includes('device_code') && (
            <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => void onStartDeviceCode(profile.id)}>
              Use device code instead
            </Button>
          )}
        </div>
      )}

      {profile.methods.includes('api_key') && (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void onConnectApiKey(profile.id, name, apiKey); }}>
          <label className="block space-y-1 text-sm text-foreground">Name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block space-y-1 text-sm text-foreground">API key<Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
          <Button type="submit" size="sm" disabled={busy || !name.trim() || !apiKey.trim()}><KeyRound className="h-4 w-4" />Connect API key</Button>
        </form>
      )}

      {profile.methods.includes('oauth') && (
        <Button type="button" size="sm" disabled={busy} onClick={() => void onStartOAuth(profile.id)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ExternalLink className="h-4 w-4" />}
          Continue in browser
        </Button>
      )}

      {profile.methods.includes('device_code') && !deviceChallenge && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onStartDeviceCode(profile.id)}>Start device code</Button>
      )}
      {deviceChallenge && (
        <OAuthDeviceFlow challenge={deviceChallenge} status={deviceStatus} onCancel={() => void onCancelDeviceCode(profile.id, deviceChallenge.transactionId)} />
      )}

      {profile.methods.includes('custom') && <CustomProviderEditor busy={busy} onCreate={onCreateCustomProvider} />}
    </div>
  );
}
