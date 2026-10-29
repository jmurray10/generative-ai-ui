export interface TranscriptLine {
  who: 'user' | 'ai';
  text: string;
  /** Still growing. A later update for this utterance replaces the line. */
  partial?: boolean;
  /** xAI item id, when the server sent one. Same id is one utterance. */
  itemId?: string;
}

const MAX_LINES = 8;

/**
 * Fold one transcript event into the log.
 * Cumulative ASR updates ("What is the" → "What is the current count?") and
 * duplicate deliveries of that same utterance replace the open line.
 * A different sentence from the same speaker starts a new line.
 */
export function applyTranscript(lines: TranscriptLine[], incoming: TranscriptLine): TranscriptLine[] {
  const next: TranscriptLine = {
    who: incoming.who,
    text: incoming.text,
    partial: Boolean(incoming.partial),
    ...(incoming.itemId ? { itemId: incoming.itemId } : {}),
  };

  if (next.itemId) {
    const idx = lines.findIndex((line) => line.who === next.who && line.itemId === next.itemId);
    if (idx >= 0) {
      const copy = lines.slice();
      copy[idx] = next;
      return copy.slice(-MAX_LINES);
    }
  }

  const last = lines[lines.length - 1];
  if (!last || last.who !== next.who) return [...lines, next].slice(-MAX_LINES);

  // An open line always updates in place, including an ASR revision that
  // does not share a prefix. A closed line still absorbs a cumulative or
  // duplicate copy of the same utterance.
  const sameUtterance = last.partial || next.text === last.text || (last.text.length > 0 && next.text.startsWith(last.text));
  if (!sameUtterance) return [...lines, next].slice(-MAX_LINES);
  return [...lines.slice(0, -1), next].slice(-MAX_LINES);
}
