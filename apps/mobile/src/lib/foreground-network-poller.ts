export interface PollerNetworkState {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}

export interface PollerOptions {
  intervalMs: number;
  network: {
    getState: () => Promise<PollerNetworkState>;
    subscribe: (listener: (state: PollerNetworkState) => void) => {
      remove: () => void;
    };
  };
  onPoll: () => Promise<void> | void;
  appState: {
    getCurrentState: () => string | null;
    subscribe: (listener: (state: string) => void) => {
      remove: () => void;
    };
  };
  // Injectable for deterministic tests and to keep the core independent from
  // React Native's timer implementation.
  setInterval?: (
    callback: () => void,
    timeout: number
  ) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
}

function networkIsOnline(state: PollerNetworkState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function appIsForeground(state: string | null): boolean {
  return state === "active";
}

export class ForegroundNetworkPoller {
  private readonly options: PollerOptions;
  private readonly setIntervalFn: (
    callback: () => void,
    timeout: number
  ) => ReturnType<typeof setInterval>;
  private readonly clearIntervalFn: (
    timer: ReturnType<typeof setInterval>
  ) => void;
  private appSubscription: { remove: () => void } | null = null;
  private networkSubscription: { remove: () => void } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private polling = false;
  private foreground = false;
  private online = false;
  private networkChanged = false;

  constructor(options: PollerOptions) {
    this.options = options;
    this.setIntervalFn = options.setInterval ?? setInterval;
    this.clearIntervalFn = options.clearInterval ?? clearInterval;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.networkChanged = false;
    this.foreground = appIsForeground(this.options.appState.getCurrentState());
    this.appSubscription = this.options.appState.subscribe((state) => {
      this.foreground = appIsForeground(state);
      this.reconcile();
    });
    this.networkSubscription = this.options.network.subscribe((state) => {
      this.networkChanged = true;
      this.online = networkIsOnline(state);
      this.reconcile();
    });
    void this.loadInitialNetworkState();
  }

  stop(): void {
    this.running = false;
    this.appSubscription?.remove();
    this.appSubscription = null;
    this.networkSubscription?.remove();
    this.networkSubscription = null;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  private async loadInitialNetworkState(): Promise<void> {
    try {
      const state = await this.options.network.getState();
      if (this.running && !this.networkChanged) {
        this.online = networkIsOnline(state);
        this.reconcile();
      }
    } catch {
      // A network capability lookup must not prevent a later network event
      // from starting the poller.
    }
  }

  private reconcile(): void {
    if (!this.running || !this.foreground || !this.online) {
      this.clearTimer();
      return;
    }
    if (this.timer === null) {
      void this.poll();
      this.timer = this.setIntervalFn(() => {
        void this.poll();
      }, this.options.intervalMs);
    }
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.foreground || !this.online || this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.options.onPoll();
    } catch {
      // Polling is best effort. The next tick or foreground/online transition
      // retries without leaving a stuck in-flight guard behind.
    } finally {
      this.polling = false;
    }
  }
}
