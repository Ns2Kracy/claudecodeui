import React, { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { Button, Input } from "../../../../../shared/view/ui";

import type { NineRouterProviderProfile } from "./ProviderCatalog.js";
import {
	draftForApiKeyProfile,
	type ApiKeyProviderDraft,
	type ApiKeyProviderDraftErrors,
	validateApiKeyProviderDraft,
} from "./apiKeyProvider.js";

type DraftErrors = ApiKeyProviderDraftErrors;

type ApiKeyProviderEditorProps = {
	profile: NineRouterProviderProfile;
	busy: boolean;
	onConnect: (draft: ApiKeyProviderDraft) => Promise<boolean>;
};

export default function ApiKeyProviderEditor({
	profile,
	busy,
	onConnect,
}: ApiKeyProviderEditorProps) {
	const [draft, setDraft] = useState(() => draftForApiKeyProfile(profile));
	const [errors, setErrors] = useState<DraftErrors>({});

	const update = (field: keyof ApiKeyProviderDraft, value: string) => {
		setDraft((current) => ({ ...current, [field]: value }));
		setErrors((current) => ({ ...current, [field]: undefined }));
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		const nextErrors = validateApiKeyProviderDraft(draft);
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length > 0) return;
		if (await onConnect(draft)) setDraft(draftForApiKeyProfile(profile));
	};

	return (
		<form className="space-y-4" onSubmit={submit} noValidate>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="space-y-1 text-sm text-foreground">
					Name
					<Input
						value={draft.name}
						onChange={(event) => update("name", event.target.value)}
						aria-invalid={Boolean(errors.name)}
					/>
				</label>
				<label className="space-y-1 text-sm text-foreground">
					Base URL
					<Input
						type="url"
						placeholder="https://api.example.com/v1"
						value={draft.baseUrl}
						onChange={(event) => update("baseUrl", event.target.value)}
						aria-invalid={Boolean(errors.baseUrl)}
					/>
				</label>
			</div>
			<label className="block space-y-1 text-sm text-foreground">
				API key
				<Input
					type="password"
					autoComplete="off"
					value={draft.apiKey}
					onChange={(event) => update("apiKey", event.target.value)}
					aria-invalid={Boolean(errors.apiKey)}
				/>
			</label>

			<details className="group border-y border-border py-2">
				<summary className="cursor-pointer select-none py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					Advanced settings
				</summary>
				<div className="grid gap-3 pt-3 sm:grid-cols-2">
					<label className="space-y-1 text-sm text-foreground">
						Prefix
						<Input
							value={draft.prefix}
							onChange={(event) => update("prefix", event.target.value)}
							aria-invalid={Boolean(errors.prefix)}
						/>
					</label>
					{draft.type === "openai-compatible" && (
						<label className="space-y-1 text-sm text-foreground">
							API type
							<select
								value={draft.apiType}
								onChange={(event) => update("apiType", event.target.value)}
								className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<option value="responses">Responses API</option>
								<option value="chat">Chat Completions</option>
							</select>
						</label>
					)}
					<label className="space-y-1 text-sm text-foreground sm:col-span-2">
						Model ID{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
						<Input
							placeholder="model-id"
							value={draft.modelId}
							onChange={(event) => update("modelId", event.target.value)}
						/>
					</label>
				</div>
			</details>

			{Object.values(errors).some(Boolean) && (
				<p role="alert" className="text-sm text-destructive">
					Complete the required provider fields.
				</p>
			)}
			<Button type="submit" disabled={busy}>
				{busy ? (
					<Loader2 className="animate-spin motion-reduce:animate-none" />
				) : (
					<KeyRound />
				)}
				Validate and connect
			</Button>
		</form>
	);
}
