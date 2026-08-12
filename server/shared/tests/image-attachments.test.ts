import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	appendFilesInputTag,
	appendImagesInputTag,
	buildCodexInputItems,
	isImageAttachmentDescriptor,
	normalizeAttachmentDescriptors,
	isAllowedImageSourcePath,
	normalizeImageDescriptors,
	parseFilesInputTag,
	parseImagesInputTag,
	resolveImageMediaType,
	toImageAttachments,
} from "@/shared/image-attachments.js";

const SYMLINK_UNSUPPORTED_CODES = new Set([
	"EACCES",
	"EINVAL",
	"ENOSYS",
	"ENOTSUP",
	"EPERM",
]);

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

async function createSymlinkIfSupported(
	target: string,
	linkPath: string,
	type: "dir" | "file" | "junction",
): Promise<boolean> {
	try {
		await symlink(target, linkPath, type);
		return true;
	} catch (error) {
		if (
			isErrnoException(error) &&
			typeof error.code === "string" &&
			SYMLINK_UNSUPPORTED_CODES.has(error.code)
		) {
			return false;
		}
		throw error;
	}
}

test("normalizeImageDescriptors accepts objects and bare paths, drops junk", () => {
	const descriptors = normalizeImageDescriptors([
		{ path: ".cloudcli/assets/a.png", name: "a.png", mimeType: "image/png" },
		"scripts/pic.jpg",
		{ name: "no-path.png" },
		42,
		null,
		"",
	]);

	assert.deepEqual(descriptors, [
		{ path: ".cloudcli/assets/a.png", name: "a.png", mimeType: "image/png" },
		{ path: "scripts/pic.jpg" },
	]);
	assert.deepEqual(normalizeImageDescriptors(undefined), []);
	assert.deepEqual(normalizeImageDescriptors("not-an-array"), []);
});

test("normalizeAttachmentDescriptors preserves file metadata and identifies images", () => {
	const [pdf, image] = normalizeAttachmentDescriptors([
		{
			path: "brief.pdf",
			name: "brief.pdf",
			mimeType: "application/pdf",
			size: 4096,
		},
		{ path: "diagram.PNG" },
	]);

	assert.deepEqual(pdf, {
		path: "brief.pdf",
		name: "brief.pdf",
		mimeType: "application/pdf",
		size: 4096,
	});
	assert.equal(isImageAttachmentDescriptor(pdf), false);
	assert.equal(isImageAttachmentDescriptor(image), true);
});

test("appendFilesInputTag and parseFilesInputTag round-trip non-image files", () => {
	const prompt = "Summarize the attached materials.";
	const tagged = appendFilesInputTag(prompt, [
		{
			path: "C:\\Users\\x\\.cloudcli\\assets\\brief.pdf",
			name: "Brief (final).pdf",
		},
		{ path: "/tmp/cloudcli-assets/data.csv", name: "data.csv" },
	]);

	assert.ok(tagged.includes("<files_input>"));
	assert.ok(tagged.includes("The user attached 2 file(s)"));
	assert.deepEqual(parseFilesInputTag(tagged), {
		text: prompt,
		filePaths: [
			"C:/Users/x/.cloudcli/assets/brief.pdf",
			"/tmp/cloudcli-assets/data.csv",
		],
		attachments: [
			{
				path: "C:/Users/x/.cloudcli/assets/brief.pdf",
				name: "Brief final.pdf",
			},
			{ path: "/tmp/cloudcli-assets/data.csv", name: "data.csv" },
		],
	});
});

test("parseFilesInputTag handles Windows-flattened provider prompts", () => {
	const flattened = appendFilesInputTag("inspect this", [
		{ path: "C:/Users/x/.cloudcli/assets/report.docx", name: "report.docx" },
	]).replace(/\s*\r?\n\s*/g, " ");

	const parsed = parseFilesInputTag(flattened);
	assert.equal(parsed.text, "inspect this");
	assert.deepEqual(parsed.attachments, [
		{ path: "C:/Users/x/.cloudcli/assets/report.docx", name: "report.docx" },
	]);
});

test("appendImagesInputTag and parseImagesInputTag round-trip", () => {
	const prompt = "Describe these screenshots.\n\nFocus on the header.";
	const tagged = appendImagesInputTag(prompt, [
		{ path: ".cloudcli/assets/1-a.png" },
		{ path: ".cloudcli\\assets\\2-b.jpg" },
	]);

	assert.ok(tagged.startsWith(prompt));
	assert.ok(tagged.includes("<images_input>"));
	assert.ok(tagged.includes("</images_input>"));
	assert.ok(tagged.includes("The user attached 2 image(s)"));

	const parsed = parseImagesInputTag(tagged);
	assert.equal(parsed.text, prompt);
	// Backslashes are normalized so references stay portable.
	assert.deepEqual(parsed.imagePaths, [
		".cloudcli/assets/1-a.png",
		".cloudcli/assets/2-b.jpg",
	]);
});

test("original filenames round-trip through the tag", () => {
	const tagged = appendImagesInputTag("compare these", [
		{
			path: "C:/Users/x/.cloudcli/assets/1-a.png",
			name: "screenshot (final).png",
		},
		{ path: "C:/Users/x/.cloudcli/assets/2-b.jpg" },
	]);

	const parsed = parseImagesInputTag(tagged);
	assert.equal(parsed.text, "compare these");
	// Parentheses are dropped from names so the "(original name: ...)" suffix
	// stays parseable; the path-only entry carries no name.
	assert.deepEqual(parsed.attachments, [
		{
			path: "C:/Users/x/.cloudcli/assets/1-a.png",
			name: "screenshot final.png",
		},
		{ path: "C:/Users/x/.cloudcli/assets/2-b.jpg" },
	]);
});

test("only the LAST images_input block is treated as the attachment carrier", () => {
	const userTypedTag = "What does <images_input> mean in this codebase?";
	const tagged = appendImagesInputTag(
		`${userTypedTag}\n\n<images_input>\nfake user block\n</images_input>\n\nAlso check this.`,
		[{ path: "C:/Users/x/.cloudcli/assets/real.png" }],
	);

	const parsed = parseImagesInputTag(tagged);
	assert.ok(parsed.text.includes("fake user block"));
	assert.ok(parsed.text.includes("Also check this."));
	assert.deepEqual(parsed.imagePaths, ["C:/Users/x/.cloudcli/assets/real.png"]);
});

test("appendImagesInputTag without images returns the prompt untouched", () => {
	assert.equal(appendImagesInputTag("hello", []), "hello");
	assert.equal(appendImagesInputTag("hello", undefined), "hello");
});

test("parseImagesInputTag handles prompts flattened to one line for cmd.exe shims", () => {
	// Windows spawn runtimes collapse newlines before passing the argument to
	// .cmd-shimmed CLIs; the persisted prompt is then a single line.
	const flattened = appendImagesInputTag("now?", [
		{ path: "C:/Users/x/.cloudcli/assets/a.jpg" },
	])
		.replace(/\s*\r?\n\s*/g, " ")
		.trim();

	assert.ok(!flattened.includes("\n"));
	const parsed = parseImagesInputTag(flattened);
	assert.equal(parsed.text, "now?");
	assert.deepEqual(parsed.imagePaths, ["C:/Users/x/.cloudcli/assets/a.jpg"]);
});

test("parseImagesInputTag leaves text without a tag untouched", () => {
	const text =
		'Just a normal prompt with [brackets] and JSON ["like"] content.';
	const parsed = parseImagesInputTag(text);
	assert.equal(parsed.text, text);
	assert.deepEqual(parsed.imagePaths, []);
});

test("parseImagesInputTag strips a malformed tag body without attaching images", () => {
	const text = "prompt\n\n<images_input>\nnot json here\n</images_input>";
	const parsed = parseImagesInputTag(text);
	assert.equal(parsed.text, "prompt");
	assert.deepEqual(parsed.imagePaths, []);
});

test("toImageAttachments maps paths to posix attachment records", () => {
	assert.deepEqual(toImageAttachments(["a\\b\\c.png", "d/e.jpg"]), [
		{ path: "a/b/c.png" },
		{ path: "d/e.jpg" },
	]);
});

test("resolveImageMediaType prefers the mime type and falls back to the extension", () => {
	assert.equal(
		resolveImageMediaType({ path: "x.bin", mimeType: "image/webp" }),
		"image/webp",
	);
	assert.equal(resolveImageMediaType({ path: "x.JPG" }), "image/jpeg");
	assert.equal(resolveImageMediaType({ path: "x.png" }), "image/png");
	assert.equal(resolveImageMediaType({ path: "x.unknown" }), null);
});

test("buildCodexInputItems emits text plus absolute local_image paths", () => {
	const cwd = path.join(os.tmpdir(), "codex-project");
	const items = buildCodexInputItems(
		"Describe this image:",
		[{ path: ".cloudcli/assets/pic.jpg" }],
		cwd,
	);

	assert.equal(items.length, 2);
	assert.deepEqual(items[0], { type: "text", text: "Describe this image:" });
	assert.equal(items[1].type, "local_image");
	const imageItem = items[1] as Extract<
		(typeof items)[number],
		{ type: "local_image" }
	>;
	assert.ok(path.isAbsolute(imageItem.path));
	assert.equal(imageItem.path, path.resolve(cwd, ".cloudcli/assets/pic.jpg"));
});

test("isAllowedImageSourcePath only accepts the upload store and the run cwd", () => {
	const cwd = path.join(os.tmpdir(), "some-project");
	const uploadStore = path.join(os.homedir(), ".cloudcli", "assets");

	assert.equal(
		isAllowedImageSourcePath(path.join(uploadStore, "shot.png"), cwd),
		true,
	);
	assert.equal(
		isAllowedImageSourcePath(path.join(cwd, "docs", "diagram.png"), cwd),
		true,
	);

	assert.equal(
		isAllowedImageSourcePath(path.join(os.homedir(), ".ssh", "id_rsa"), cwd),
		false,
	);
	assert.equal(
		isAllowedImageSourcePath(
			path.join(cwd, "..", "other-project", "x.png"),
			cwd,
		),
		false,
	);
	// The roots themselves are directories, not readable image files.
	assert.equal(isAllowedImageSourcePath(cwd, cwd), false);
});

test("Codex builder refuses descriptors outside the allowed roots", () => {
	const cwd = path.join(os.tmpdir(), "codex-project");
	const outsidePath = path.join(os.homedir(), ".ssh", "id_rsa.png");

	const codexItems = buildCodexInputItems(
		"prompt",
		[{ path: outsidePath }],
		cwd,
	);
	assert.deepEqual(codexItems, [{ type: "text", text: "prompt" }]);
});
