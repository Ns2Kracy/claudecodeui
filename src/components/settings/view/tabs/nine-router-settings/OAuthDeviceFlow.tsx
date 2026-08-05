import React from 'react';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';

import type { RoutingDeviceCodeChallengeView } from '../../../../../../shared/routing.js';
import { Button } from '../../../../../shared/view/ui';

export type OAuthDeviceFlowStatus = 'idle' | 'pending' | 'success';

type OAuthDeviceFlowProps = {
  challenge: RoutingDeviceCodeChallengeView;
  status: OAuthDeviceFlowStatus;
  onCancel: () => void;
};

export default function OAuthDeviceFlow({ challenge, status, onCancel }: OAuthDeviceFlowProps) {
  if (status === 'success') {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        Provider connected
      </div>
    );
  }

  const verificationUrl = challenge.verificationUriComplete ?? challenge.verificationUri;
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Authorize in your browser</p>
        <a className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href={verificationUrl} target="_blank" rel="noreferrer">
          {challenge.verificationUri}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Device code</p>
        <code className="mt-1 block select-all text-lg font-semibold tracking-widest text-foreground">{challenge.userCode}</code>
      </div>
      <p className="text-xs text-muted-foreground">Expires {new Date(challenge.expiresAt).toLocaleString()}</p>
      {status === 'pending' && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          Waiting for authorization
        </div>
      )}
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
