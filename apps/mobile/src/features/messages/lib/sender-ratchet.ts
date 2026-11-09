// The next ratchet index this device should send at, per conversation, kept
// outside the transcript window. Web keeps the same counter in its outbox
// (lib/messages/outbox.ts nextRatchetIndex).
//
// Deriving the index from the rows on screen undercounted whenever the window
// was anchored in history after a search jump, and two sends started together
// (the composer and the share picker) read the same window and picked the same
// index. Each send now reserves an index here, so concurrent sends get distinct
// ones, and every own message that is seen (sent, echoed or loaded) raises the
// floor. The server still answers a stale index with 409 and the expected one,
// which covers other devices on the same account.

export interface SenderRatchet {
  forget: () => void;
  observe: (conversationId: string, ratchetIndex: number) => void;
  reserve: (conversationId: string, windowFloor: number) => number;
}

export function createSenderRatchet(): SenderRatchet {
  const next = new Map<string, number>();
  return {
    forget: () => next.clear(),
    observe: (conversationId, ratchetIndex) => {
      if (!Number.isSafeInteger(ratchetIndex) || ratchetIndex < 0) {
        return;
      }
      next.set(
        conversationId,
        Math.max(next.get(conversationId) ?? 0, ratchetIndex + 1)
      );
    },
    reserve: (conversationId, windowFloor) => {
      const index = Math.max(next.get(conversationId) ?? 0, windowFloor);
      next.set(conversationId, index + 1);
      return index;
    },
  };
}

export const senderRatchet = createSenderRatchet();
