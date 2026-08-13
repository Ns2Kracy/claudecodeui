import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

import type {
  RoutingOpenAiProviderNodeApiType,
  RoutingProviderNodeType,
} from '../../../../../../shared/routing.js';
import { Button, Input } from '../../../../../shared/view/ui';

export type CustomProviderDraft = {
  name: string;
  prefix: string;
  type: RoutingProviderNodeType;
  apiType: RoutingOpenAiProviderNodeApiType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
};

type DraftErrors = Partial<Record<keyof CustomProviderDraft, string>>;

const initialDraft: CustomProviderDraft = {
  name: '',
  prefix: '',
  type: 'openai-compatible',
  apiType: 'responses',
  baseUrl: '',
  apiKey: '',
  modelId: '',
};

function prefixForName(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function validateCustomProviderDraft(draft: CustomProviderDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.name.trim()) errors.name = 'Name is required.';
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(draft.prefix)) errors.prefix = 'Use letters, numbers, underscores, or hyphens.';
  try {
    const url = new URL(draft.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    errors.baseUrl = 'Enter a valid HTTP or HTTPS URL.';
  }
  if (!draft.apiKey.trim()) errors.apiKey = 'API key is required for validation.';
  return errors;
}

export async function validateAndSaveCustomProvider(
  draft: CustomProviderDraft,
  actions: {
    validate: () => Promise<{ valid: boolean; message: string | null }>;
    save: () => Promise<boolean>;
  },
): Promise<boolean> {
  if (Object.keys(validateCustomProviderDraft(draft)).length > 0) return false;
  const validation = await actions.validate();
  if (!validation.valid) return false;
  return actions.save();
}

type CustomProviderEditorProps = {
  busy: boolean;
  onCreate: (draft: CustomProviderDraft) => Promise<boolean>;
};

export default function CustomProviderEditor({ busy, onCreate }: CustomProviderEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [prefixEdited, setPrefixEdited] = useState(false);

  const update = (field: keyof CustomProviderDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === 'name' && !prefixEdited ? { prefix: prefixForName(value) } : {}),
    }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateCustomProviderDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (await onCreate(draft)) setDraft(initialDraft);
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-foreground">
          Name
          <Input value={draft.name} onChange={(event) => update('name', event.target.value)} aria-invalid={Boolean(errors.name)} />
        </label>
        <label className="space-y-1 text-sm text-foreground">
          Base URL
          <Input type="url" placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} aria-invalid={Boolean(errors.baseUrl)} />
        </label>
      </div>
      <label className="block space-y-1 text-sm text-foreground">
        API key
        <Input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => update('apiKey', event.target.value)} aria-invalid={Boolean(errors.apiKey)} />
      </label>

      <details className="group border-y border-border py-2">
        <summary className="cursor-pointer select-none py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Advanced settings</summary>
        <div className="grid gap-3 pt-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm text-foreground">
            Prefix
            <Input value={draft.prefix} onChange={(event) => { setPrefixEdited(true); update('prefix', event.target.value); }} aria-invalid={Boolean(errors.prefix)} />
          </label>
          <label className="space-y-1 text-sm text-foreground">
            API type
            <select value={draft.apiType} onChange={(event) => update('apiType', event.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <option value="responses">Responses API</option>
              <option value="chat">Chat Completions</option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-foreground sm:col-span-2">
            Model ID <span className="font-normal text-muted-foreground">(optional)</span>
            <Input placeholder="model-id" value={draft.modelId} onChange={(event) => update('modelId', event.target.value)} />
          </label>
        </div>
      </details>

      {Object.values(errors).some(Boolean) && <p role="alert" className="text-sm text-destructive">Complete the required provider fields.</p>}
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
        Validate and save
      </Button>
    </form>
  );
}
