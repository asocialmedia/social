export type SessionRefreshResult =
  | { sessionId: string; status: "valid" }
  | { status: "expired" }
  | { status: "unavailable" };

interface SessionConnectionOptions {
  connect: (signal: AbortSignal) => Promise<void>;
  onExpired: () => void;
  refresh: () => Promise<SessionRefreshResult>;
  sessionId: string;
}

// Cold starts and foreground transitions must finish cookie renewal before
// opening the stream. A transport rejection alone never revokes a session.
export class SessionConnection {
  private controller: AbortController | null = null;
  private readonly options: SessionConnectionOptions;

  constructor(options: SessionConnectionOptions) {
    this.options = options;
  }

  suspend(): void {
    this.controller?.abort();
    this.controller = null;
  }

  async resume(): Promise<void> {
    this.suspend();
    const controller = new AbortController();
    this.controller = controller;
    const result = await this.options.refresh();
    if (controller.signal.aborted) {
      return;
    }
    if (result.status === "expired") {
      this.options.onExpired();
      return;
    }
    if (
      result.status === "valid" &&
      result.sessionId !== this.options.sessionId
    ) {
      return;
    }
    // Offline revalidation keeps the cached identity; the stream itself uses
    // backoff and fresh credentials when connectivity returns.
    await this.options.connect(controller.signal);
  }

  async confirmUnauthorized(signal: AbortSignal): Promise<boolean> {
    const result = await this.options.refresh();
    if (signal.aborted) {
      return false;
    }
    if (result.status === "expired") {
      this.options.onExpired();
      return false;
    }
    return (
      result.status === "unavailable" ||
      result.sessionId === this.options.sessionId
    );
  }
}

// Failed or superseded revalidation is not evidence of expiry, even when a
// cached identity remains. Only a completed session response can decide it.
export function classifySessionRefresh(snapshot: {
  data: { session: { id: string } } | null;
  error: { status?: number } | null;
  isPending: boolean;
  isRefetching: boolean;
}): SessionRefreshResult {
  if (snapshot.isPending || snapshot.isRefetching) {
    return { status: "unavailable" };
  }
  if (snapshot.error) {
    return {
      status: snapshot.error.status === 401 ? "expired" : "unavailable",
    };
  }
  return snapshot.data?.session
    ? { sessionId: snapshot.data.session.id, status: "valid" }
    : { status: "expired" };
}
