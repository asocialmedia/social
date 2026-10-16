interface ReceivedMessage {
  id: string;
  createdAt: string;
  senderId: string;
}
interface DeliveryEntry {
  acknowledgedAt: number;
  pending: Promise<void> | null;
  target: ReceivedMessage;
}

// Coalesce arrivals while an acknowledgement is in flight; failures retry on the next reconcile.
export class DeliveryAcknowledger {
  private readonly entries = new Map<string, DeliveryEntry>();
  private readonly acknowledge: (
    conversationId: string,
    messageId: string
  ) => Promise<void>;
  constructor(
    acknowledge: (conversationId: string, messageId: string) => Promise<void>
  ) {
    this.acknowledge = acknowledge;
  }

  receive(
    conversationId: string,
    message: ReceivedMessage,
    myUserId: string
  ): Promise<void> {
    const at = Date.parse(message.createdAt);
    if (message.senderId === myUserId || !Number.isFinite(at)) {
      return Promise.resolve();
    }
    let entry = this.entries.get(conversationId);
    if (!entry) {
      entry = { acknowledgedAt: -Infinity, pending: null, target: message };
      this.entries.set(conversationId, entry);
    }
    if (at > Date.parse(entry.target.createdAt)) {
      entry.target = message;
    }
    if (entry.pending) {
      return entry.pending;
    }
    if (at <= entry.acknowledgedAt) {
      return Promise.resolve();
    }
    const current = entry;
    current.pending = (async () => {
      await Promise.resolve();
      while (Date.parse(current.target.createdAt) > current.acknowledgedAt) {
        const { target } = current;
        try {
          // oxlint-disable-next-line no-await-in-loop -- the newest arrival is acknowledged only after the previous request settles
          await this.acknowledge(conversationId, target.id);
          current.acknowledgedAt = Date.parse(target.createdAt);
        } catch {
          break;
        }
      }
      current.pending = null;
    })();
    return current.pending;
  }
}
