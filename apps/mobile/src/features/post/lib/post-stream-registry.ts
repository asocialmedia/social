// Refcounted registry behind the shared post streams (use-post-stream):
// every mounted thread for the same post+kind shares one SSE reader instead
// of opening one per card, matching web's CommentsRealtimeProvider contract.
// Framework-free so the acquire/release/abort contract is unit-tested; the
// hook owns the reader itself.
export interface SharedStreamEntry<TSubscriber> {
  controller: AbortController;
  subscribers: Set<TSubscriber>;
}

export class StreamRegistry<TSubscriber> {
  private readonly entries = new Map<string, SharedStreamEntry<TSubscriber>>();

  size(): number {
    return this.entries.size;
  }

  acquire(key: string): {
    controller: AbortController;
    created: boolean;
    subscribers: Set<TSubscriber>;
  } {
    const existing = this.entries.get(key);
    if (existing) {
      return {
        controller: existing.controller,
        created: false,
        subscribers: existing.subscribers,
      };
    }
    const entry: SharedStreamEntry<TSubscriber> = {
      controller: new AbortController(),
      subscribers: new Set(),
    };
    this.entries.set(key, entry);
    return {
      controller: entry.controller,
      created: true,
      subscribers: entry.subscribers,
    };
  }

  release(key: string, subscriber: TSubscriber): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    entry.subscribers.delete(subscriber);
    if (entry.subscribers.size === 0) {
      entry.controller.abort();
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
    }
  }
}
