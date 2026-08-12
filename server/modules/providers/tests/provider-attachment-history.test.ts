import assert from "node:assert/strict";
import test from "node:test";

import {
	CodexSessionsProvider,
	extractCodexUserImages,
} from "@/modules/providers/list/codex/codex-sessions.provider.js";
import { appendFilesInputTag } from "@/shared/image-attachments.js";

const SESSION_ID = "session-1";

test("codex history: user_message payload images become path attachments", () => {
	// Real rollout shape: local_image input items land in `local_images`,
	// while `images` stays an empty array.
	assert.deepEqual(
		extractCodexUserImages({
			type: "user_message",
			message: "can u see attached image?",
			images: [],
			local_images: ["C:\\proj\\.cloudcli\\assets\\a.png"],
		}),
		[{ path: "C:/proj/.cloudcli/assets/a.png" }],
	);
	assert.deepEqual(
		extractCodexUserImages({
			type: "user_message",
			message: "hi",
			images: ["/proj/b.jpg"],
		}),
		[{ path: "/proj/b.jpg" }],
	);
	assert.equal(
		extractCodexUserImages({ type: "user_message", message: "hi" }),
		undefined,
	);
	assert.equal(
		extractCodexUserImages({
			type: "user_message",
			message: "hi",
			images: [],
			local_images: [],
		}),
		undefined,
	);
});

test("codex history: base64 data URLs pass through as inline data attachments", () => {
	const dataUrl = "data:image/png;base64,QUJD";
	assert.deepEqual(
		extractCodexUserImages({
			type: "user_message",
			message: "look",
			images: [dataUrl],
			local_images: ["C:\\proj\\a.png"],
		}),
		[{ path: "C:/proj/a.png" }, { data: dataUrl }],
	);
});

test("codex history: normalized user entries keep their images", () => {
	const provider = new CodexSessionsProvider();
	const messages = provider.normalizeMessage(
		{
			timestamp: "2026-07-03T10:00:00.000Z",
			message: { role: "user", content: "Look at this" },
			images: [{ path: ".cloudcli/assets/a.png" }],
		},
		SESSION_ID,
	);

	assert.equal(messages.length, 1);
	assert.equal(messages[0].role, "user");
	assert.equal(messages[0].content, "Look at this");
	assert.deepEqual(messages[0].images, [{ path: ".cloudcli/assets/a.png" }]);
});

test("codex history: normalized user entries restore file reference blocks", () => {
	const provider = new CodexSessionsProvider();
	const messages = provider.normalizeMessage(
		{
			timestamp: "2026-07-03T10:00:00.000Z",
			message: {
				role: "user",
				content: appendFilesInputTag("Review this", [
					{ path: "C:/Users/x/.cloudcli/assets/spec.docx", name: "spec.docx" },
				]),
			},
		},
		SESSION_ID,
	);

	assert.equal(messages[0].content, "Review this");
	assert.deepEqual(messages[0].files, [
		{ path: "C:/Users/x/.cloudcli/assets/spec.docx", name: "spec.docx" },
	]);
});
