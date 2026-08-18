import type { ThreadEvent } from "@openai/codex-sdk";

type CodexVisibleEventBuffer = {
	push(event: ThreadEvent): ThreadEvent[];
};

/**
 * Buffers completed agent messages for the Codex runtime so only the final
 * response is published. The runtime and its regression test consume this
 * component; reasoning and tool events pass through immediately.
 */
export function createCodexVisibleEventBuffer(): CodexVisibleEventBuffer {
	let pendingAgentMessage: ThreadEvent | null = null;

	return {
		push(event) {
			if (event.type === "item.completed" && event.item.type === "agent_message") {
				pendingAgentMessage = event;
				return [];
			}

			if (event.type === "turn.completed") {
				const visibleEvents = pendingAgentMessage
					? [pendingAgentMessage, event]
					: [event];
				pendingAgentMessage = null;
				return visibleEvents;
			}

			if (event.type === "turn.failed") {
				pendingAgentMessage = null;
			}

			return [event];
		},
	};
}
