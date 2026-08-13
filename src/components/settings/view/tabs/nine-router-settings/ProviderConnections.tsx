import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, Loader2 } from 'lucide-react';

import type { RoutingDeviceCodeChallengeView } from '../../../../../../shared/routing.js';
import { Button } from '../../../../../shared/view/ui';

import type { CustomProviderDraft } from './CustomProviderEditor.js';
import { NINE_ROUTER_PROVIDER_PROFILES } from './ProviderCatalog.js';
import ProviderConnectionDialog, { isAllowedOAuthUrl } from './ProviderConnectionDialog.js';
import ProviderIcon from './ProviderIcon.js';
import { routingApi, RoutingApiError } from './routingApi.js';

type ProviderConnectionsProps = {
  disabled: boolean;
  onConnected: () => Promise<void> | void;
};

type SafeError = { code: string; message: string; status: number; retryable: boolean };

function safeError(error: unknown): SafeError {
  if (error instanceof RoutingApiError) return error;
  return { code: 'ROUTING_OPERATION_FAILED', message: error instanceof Error ? error.message : 'The provider could not be connected.', status: 0, retryable: true };
}

export default function ProviderConnections({ disabled, onConnected }: ProviderConnectionsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SafeError | null>(null);
  const [challenge, setChallenge] = useState<RoutingDeviceCodeChallengeView | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<'idle' | 'pending' | 'success'>('idle');
  const popupRef = useRef<Window | null>(null);
  const oauthRef = useRef<{ provider: string; transactionId: string } | null>(null);
  const profiles = NINE_ROUTER_PROVIDER_PROFILES;
  const codex = profiles.find((item) => item.id === 'codex')!;
  const popular = profiles.filter((item) => item.group === 'popular');
  const custom = profiles.find((item) => item.group === 'custom')!;
  const profile = profiles.find((item) => item.id === selectedId) ?? null;

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
    const timer = window.setTimeout(async () => {
      try {
        const result = await routingApi.pollDeviceCode(challenge.provider, challenge.transactionId);
        if (cancelled) return;
        if (result.pending) setChallenge({ ...challenge });
        else { setDeviceStatus('success'); await onConnected(); }
      } catch (nextError) {
        if (!cancelled) { setError(safeError(nextError)); setDeviceStatus('idle'); }
      }
    }, Math.max(1, challenge.interval ?? 5) * 1_000);
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

  const startOAuth = (provider: string) => run(async () => {
    const started = await routingApi.startOAuth(provider);
    if (!isAllowedOAuthUrl(started.authUrl)) throw new Error('9Router returned an unsafe OAuth URL.');
    const popup = window.open(started.authUrl, 'cloudcli-9router-oauth', 'popup,width=720,height=760');
    if (!popup) throw new Error('OAuth popup was blocked. Allow popups and try again.');
    popupRef.current = popup;
    oauthRef.current = { provider, transactionId: started.transactionId };
  });

  const select = (id: string) => {
    setSelectedId((current) => current === id ? null : id);
    setError(null);
    setChallenge(null);
    setDeviceStatus('idle');
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="codex-oauth-title" className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <ProviderIcon icon={codex.icon} label="Codex" className="h-6 w-6" />
          </span>
          <div>
            <h4 id="codex-oauth-title" className="text-sm font-semibold text-foreground">Connect Codex</h4>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">Sign in with ChatGPT. OAuth credentials stay in 9Router and are never stored by CloudCLI.</p>
          </div>
        </div>
        <Button type="button" className="shrink-0" disabled={disabled || busy} onClick={() => void startOAuth(codex.id)}>
          {busy && selectedId === null ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ExternalLink />}
          Continue with ChatGPT
        </Button>
      </section>

      <section aria-labelledby="popular-providers-title" className="space-y-3">
        <div>
          <h4 id="popular-providers-title" className="text-sm font-semibold text-foreground">Popular API keys</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose a provider, then add a write-only API key.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="list" aria-label="Popular API key providers">
          {popular.map((item) => (
            <Button key={item.id} type="button" variant={selectedId === item.id ? 'secondary' : 'outline'} disabled={disabled} aria-expanded={selectedId === item.id} onClick={() => select(item.id)}>
              <ProviderIcon icon={item.icon} label={item.name} />
              {item.name}
            </Button>
          ))}
        </div>
      </section>

      <section aria-labelledby="custom-provider-title" className="space-y-3">
        <button type="button" disabled={disabled} aria-expanded={selectedId === custom.id} onClick={() => select(custom.id)} className="flex w-full items-center gap-3 border-y border-border py-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
            <ProviderIcon icon={custom.icon} label={custom.name} />
          </span>
          <span className="min-w-0 flex-1">
            <span id="custom-provider-title" className="block text-sm font-medium text-foreground">{custom.name}</span>
            <span className="block text-xs text-muted-foreground">{custom.description}</span>
          </span>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedId === custom.id ? 'rotate-90' : ''}`} />
        </button>
      </section>

      {profile && (
        <div className="border-l-2 border-primary/50 pl-4">
          <ProviderConnectionDialog
            key={profile.id}
            profile={profile}
            busy={busy}
            error={error}
            deviceChallenge={challenge}
            deviceStatus={deviceStatus}
            onConnectApiKey={(provider, name, apiKey) => run(async () => { await routingApi.createAccount({ provider, name, apiKey }); setSelectedId(null); await onConnected(); })}
            onStartOAuth={startOAuth}
            onStartDeviceCode={(provider) => run(async () => { setChallenge(await routingApi.startDeviceCode(provider)); setDeviceStatus('pending'); })}
            onCancelDeviceCode={async (provider, transactionId) => { await run(async () => { await routingApi.cancelDeviceCode(provider, transactionId); setChallenge(null); setDeviceStatus('idle'); }); }}
            onCreateCustomProvider={(draft: CustomProviderDraft) => run(async () => {
              const validation = await routingApi.validateProviderNode({ baseUrl: draft.baseUrl, apiKey: draft.apiKey, type: draft.type, ...(draft.modelId ? { modelId: draft.modelId } : {}) });
              if (!validation.valid) throw new Error(validation.message ?? 'Provider validation failed');
              await routingApi.createProviderNode({ name: draft.name, prefix: draft.prefix, type: draft.type, apiType: draft.apiType, baseUrl: draft.baseUrl });
              setSelectedId(null);
              await onConnected();
            })}
          />
        </div>
      )}
    </div>
  );
}
