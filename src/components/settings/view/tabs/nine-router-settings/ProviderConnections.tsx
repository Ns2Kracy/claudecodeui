import React, { useEffect, useRef, useState } from 'react';

import type { RoutingDeviceCodeChallengeView } from '../../../../../../shared/routing.js';
import { Button } from '../../../../../shared/view/ui';

import type { CustomProviderDraft } from './CustomProviderEditor.js';
import { NINE_ROUTER_PROVIDER_PROFILES } from './ProviderCatalog.js';
import ProviderConnectionDialog, { isAllowedOAuthUrl } from './ProviderConnectionDialog.js';
import { routingApi, RoutingApiError } from './routingApi.js';

type ProviderConnectionsProps = {
  disabled: boolean;
  onConnected: () => Promise<void> | void;
};

type SafeError = { code: string; message: string; status: number; retryable: boolean };

function safeError(error: unknown): SafeError {
  if (error instanceof RoutingApiError) return error;
  return { code: 'ROUTING_OPERATION_FAILED', message: 'The provider could not be connected.', status: 0, retryable: true };
}

export default function ProviderConnections({ disabled, onConnected }: ProviderConnectionsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SafeError | null>(null);
  const [challenge, setChallenge] = useState<RoutingDeviceCodeChallengeView | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<'idle' | 'pending' | 'success'>('idle');
  const popupRef = useRef<Window | null>(null);
  const oauthRef = useRef<{ provider: string; transactionId: string } | null>(null);
  const profile = NINE_ROUTER_PROVIDER_PROFILES.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    const receiveCallback = (event: MessageEvent) => {
      const transaction = oauthRef.current;
      if (event.origin !== window.location.origin || event.source !== popupRef.current || !transaction) return;
      if (!event.data || event.data.type !== 'routing-oauth-callback' || typeof event.data.url !== 'string') return;
      let callback: URL;
      try { callback = new URL(event.data.url); } catch { return; }
      const expectedPath = `/api/routing/oauth/${encodeURIComponent(transaction.provider)}/callback`;
      if (callback.origin !== window.location.origin || callback.pathname !== expectedPath) return;
      const state = callback.searchParams.get('state');
      const code = callback.searchParams.get('code');
      if (!state || !code) return;
      setBusy(true);
      void routingApi.exchangeOAuth(transaction.provider, { transactionId: transaction.transactionId, state, code })
        .then(async () => { setError(null); await onConnected(); })
        .catch((nextError) => setError(safeError(nextError)))
        .finally(() => { oauthRef.current = null; popupRef.current?.close(); popupRef.current = null; setBusy(false); });
    };
    window.addEventListener('message', receiveCallback);
    return () => window.removeEventListener('message', receiveCallback);
  }, [onConnected]);

  useEffect(() => {
    if (!challenge || deviceStatus !== 'pending') return undefined;
    let cancelled = false;
    const delay = Math.max(1, challenge.interval ?? 5) * 1_000;
    const timer = window.setTimeout(async () => {
      try {
        const result = await routingApi.pollDeviceCode(challenge.provider, challenge.transactionId);
        if (cancelled) return;
        if (result.pending) setChallenge({ ...challenge });
        else { setDeviceStatus('success'); await onConnected(); }
      } catch (nextError) {
        if (!cancelled) { setError(safeError(nextError)); setDeviceStatus('idle'); }
      }
    }, delay);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [challenge, deviceStatus, onConnected]);

  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try { await operation(); return true; }
    catch (nextError) { setError(safeError(nextError)); return false; }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="list" aria-label="Provider connection methods">
        {NINE_ROUTER_PROVIDER_PROFILES.map((item) => (
          <Button key={item.id} type="button" size="sm" variant={selectedId === item.id ? 'default' : 'outline'} disabled={disabled} onClick={() => { setSelectedId(item.id); setError(null); setChallenge(null); }}>
            {item.name}
          </Button>
        ))}
      </div>
      {profile && (
        <ProviderConnectionDialog
          profile={profile}
          busy={busy}
          error={error}
          deviceChallenge={challenge}
          deviceStatus={deviceStatus}
          onConnectApiKey={(provider, name, apiKey) => run(async () => { await routingApi.createAccount({ provider, name, apiKey }); await onConnected(); })}
          onStartOAuth={(provider) => run(async () => {
            const started = await routingApi.startOAuth(provider);
            if (!isAllowedOAuthUrl(started.authUrl)) throw new Error('Unsafe OAuth URL');
            const popup = window.open(started.authUrl, 'cloudcli-9router-oauth', 'popup,width=720,height=760');
            if (!popup) throw new Error('OAuth popup was blocked');
            popupRef.current = popup;
            oauthRef.current = { provider, transactionId: started.transactionId };
          })}
          onStartDeviceCode={(provider) => run(async () => { setChallenge(await routingApi.startDeviceCode(provider)); setDeviceStatus('pending'); })}
          onCancelDeviceCode={async (provider, transactionId) => { await run(async () => { await routingApi.cancelDeviceCode(provider, transactionId); setChallenge(null); setDeviceStatus('idle'); }); }}
          onCreateCustomProvider={(draft: CustomProviderDraft) => run(async () => {
            const validation = await routingApi.validateProviderNode({ baseUrl: draft.baseUrl, apiKey: draft.apiKey, type: draft.type, ...(draft.modelId ? { modelId: draft.modelId } : {}) });
            if (!validation.valid) throw new Error(validation.message ?? 'Provider validation failed');
            await routingApi.createProviderNode({ name: draft.name, prefix: draft.prefix, type: draft.type, apiType: draft.apiType, baseUrl: draft.baseUrl });
            await onConnected();
          })}
        />
      )}
    </div>
  );
}
