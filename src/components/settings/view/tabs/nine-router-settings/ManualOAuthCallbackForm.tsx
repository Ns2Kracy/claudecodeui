import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button, Input } from "../../../../../shared/view/ui";

type ManualOAuthCallbackFormProps = {
	busy: boolean;
	error: string | null;
	onSubmit: (callbackUrl: string) => Promise<boolean>;
};

/** Allows remote users to complete a loopback OAuth redirect manually. */
export default function ManualOAuthCallbackForm({
	busy,
	error,
	onSubmit,
}: ManualOAuthCallbackFormProps) {
	const [callbackUrl, setCallbackUrl] = useState("");
	return (
		<details className="rounded-md border border-border bg-muted/20 p-3">
			<summary className="cursor-pointer text-sm font-medium text-foreground">
				Having trouble completing sign-in?
			</summary>
			<form
				className="mt-3 space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					void onSubmit(callbackUrl).then((succeeded) => {
						if (succeeded) setCallbackUrl("");
					});
				}}
			>
				<label
					className="block text-xs font-medium text-foreground"
					htmlFor="oauth-callback-url"
				>
					Paste the callback URL
				</label>
				<Input
					id="oauth-callback-url"
					type="url"
					value={callbackUrl}
					onChange={(event) => setCallbackUrl(event.target.value)}
					placeholder="http://localhost:1455/auth/callback?..."
					autoComplete="off"
					spellCheck={false}
					disabled={busy}
					required
				/>
				<p className="text-xs text-muted-foreground">
					After authorizing, copy the full URL from the browser address bar and
					paste it here.
				</p>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<Button type="submit" size="sm" disabled={busy || !callbackUrl.trim()}>
					{busy && (
						<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
					)}
					Complete connection
				</Button>
			</form>
		</details>
	);
}
