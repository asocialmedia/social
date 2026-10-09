// One authoritative count for every Messages badge; never notification counts.
export class UnreadMessageStore {
  private count = 0;
  private scope: string | null = null;
  private generation = 0;
  private load: (() => Promise<number>) | null = null;
  private pending: Promise<void> | null = null;
  private refreshAgain = false;
  private listeners = new Set<() => void>();
  private activityListeners = new Set<() => void>();

  getSnapshot = (): number => this.count;
  getScope = (): string | null => this.scope;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  subscribeActivity = (listener: () => void): (() => void) => {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  };

  configure(scope: string | null, load?: () => Promise<number>): void {
    this.generation += 1;
    this.pending = null;
    this.refreshAgain = false;
    this.load = load ?? null;
    if (this.scope !== scope) {
      this.scope = scope;
      this.set(0);
    }
  }

  private set(count: number): void {
    const next = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    if (next === this.count) {
      return;
    }
    this.count = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  refresh = (): Promise<void> => {
    if (this.pending) {
      this.refreshAgain = true;
      return this.pending;
    }
    const { load } = this;
    if (!load) {
      return Promise.resolve();
    }
    const { generation } = this;
    this.pending = (async () => {
      // Assign pending before a synchronous loader failure can settle.
      await Promise.resolve();
      do {
        this.refreshAgain = false;
        try {
          // oxlint-disable-next-line no-await-in-loop -- an arrival during this request needs a newer authoritative response
          const count = await load();
          if (generation !== this.generation) {
            return;
          }
          this.set(count);
        } catch {
          // Retain the last known badge during network failures.
        }
      } while (generation === this.generation && this.refreshAgain);
      if (generation === this.generation) {
        this.pending = null;
      }
    })();
    return this.pending;
  };

  notifyActivity = (): void => {
    void this.refresh();
    for (const listener of this.activityListeners) {
      listener();
    }
  };
}

export const unreadMessageStore = new UnreadMessageStore();
