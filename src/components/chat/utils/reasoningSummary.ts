import type { ChatMessage, Provider } from "../types/types";

export type CodexReasoningSummary = {
  statusLabel: string | null;
  displayContent: string;
  transcriptOnly: boolean;
};

const STRUCTURED_HEADING = /^\*\*([^*\n]+)\*\*(?:\r?\n)([\s\S]*)$/;
const TITLE_ONLY = /^\*\*([^*\n]+)\*\*$/;
const EMPTY_SUMMARY_PLACEHOLDER = "<!-- -->";

/**
 * Applies the same summary-level interpretation as the official Codex client:
 * a leading bold phrase is a status heading, while unstructured prose is
 * retained only for detailed transcripts.
 */
export function parseCodexReasoningSummary(
  content: string,
): CodexReasoningSummary {
  const source = String(content || "").trim();
  let placeholderHeading: string | null = null;
  const parts = source.split(/\r?\n\s*\r?\n/).flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed || trimmed === EMPTY_SUMMARY_PLACEHOLDER) return [];

    const heading = trimmed.match(STRUCTURED_HEADING);
    if (heading?.[2]?.trim() === EMPTY_SUMMARY_PLACEHOLDER) {
      placeholderHeading ??= heading[1].trim();
      return [];
    }
    return [trimmed];
  });
  const visibleContent = parts.join("\n\n");

  if (!visibleContent) {
    return {
      statusLabel: placeholderHeading,
      displayContent: "",
      transcriptOnly: !placeholderHeading,
    };
  }

  const structured = visibleContent.match(STRUCTURED_HEADING);
  if (structured) {
    return {
      statusLabel: structured[1].trim(),
      displayContent: structured[2].trim(),
      transcriptOnly: false,
    };
  }

  const titleOnly = visibleContent.match(TITLE_ONLY);
  if (titleOnly) {
    return {
      statusLabel: titleOnly[1].trim(),
      displayContent: visibleContent,
      transcriptOnly: false,
    };
  }

  return {
    statusLabel: null,
    displayContent: visibleContent,
    transcriptOnly: true,
  };
}

/**
 * Coalesces only adjacent, unstructured Codex reasoning rows into one
 * transcript block. Boundaries such as users, tools, answers, and structured
 * status summaries remain independent. Repeated content is kept once while
 * distinct content remains available inside the same accordion.
 */
export function mergeConsecutiveCodexReasoning(
  messages: ChatMessage[],
  provider: Provider | string,
): ChatMessage[] {
  if (provider !== "codex") {
    return messages;
  }

  const merged: ChatMessage[] = [];
  let transcriptContents: Set<string> | null = null;

  for (const message of messages) {
    const summary = message.isThinking
      ? parseCodexReasoningSummary(String(message.content || ""))
      : null;

    if (summary?.transcriptOnly && summary.displayContent) {
      const sourceContent = String(message.content || "");

      if (transcriptContents) {
        if (!transcriptContents.has(sourceContent)) {
          const previous = merged[merged.length - 1];
          merged[merged.length - 1] = {
            ...previous,
            content: `${String(previous.content || "")}\n\n${summary.displayContent}`,
          };
          transcriptContents.add(sourceContent);
        }
        continue;
      }

      merged.push({ ...message, content: summary.displayContent });
      transcriptContents = new Set([sourceContent]);
      continue;
    }

    merged.push(message);
    transcriptContents = null;
  }

  return merged;
}

/**
 * Filters provider events before grouping and rendering. Codex keeps structured
 * summary headings in the normal view but hides transcript-only reasoning;
 * other providers preserve the existing all-or-nothing preference.
 */
export function filterMessagesForDisplay(
  messages: ChatMessage[],
  provider: Provider | string,
  showDetailedReasoning: boolean,
): ChatMessage[] {
  return messages.filter((message) => {
    if (!message.isThinking) {
      return true;
    }
    if (provider !== "codex") {
      return showDetailedReasoning;
    }

    const summary = parseCodexReasoningSummary(String(message.content || ""));
    if (!summary.displayContent) {
      return false;
    }
    return showDetailedReasoning || !summary.transcriptOnly;
  });
}
