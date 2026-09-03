# Repository guidance

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Routed model IDs

Treat routed model IDs as opaque values and preserve the exact selected ID end to end through model discovery, selection, session persistence, routing resolution, and runtime dispatch. Never parse an ID by `/`, take its basename, strip its provider/node prefix, or collapse repeated slashes. 9router model IDs can contain an intentional provider prefix followed by a double slash, for example `openai-compatible-chat-<uuid>//DATA/llm/models/<model>.gguf`.

When 9router returns a provider model ID beginning with `/`, qualify it as `${providerSpecificData.prefix}/${id}` and retain that result verbatim. This is a regression-sensitive contract previously fixed by commits `b45cc80` and `dcacfe6`. Any change affecting model discovery or routing must include an exact-ID regression test covering a prefixed model path.
