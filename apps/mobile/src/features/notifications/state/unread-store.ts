// Unread-notification count store: one module-level source of truth for the
// header bell badge, mirroring how the feed cache is shared without a state
// library. Polling lives here (60s, same interval as web's React Query) so the
// header, the bottom dock and the notifications screen all read one number and
// one timer.
//
// Pure: no React Native or Expo imports, so it is unit-testable on Node.

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";

import {
  fetchUnreadCount,
  markAllNotificationsRead,
} from "../lib/notifications-api";

// Same cadence as web's useUnreadNotificationCount.
export const UNREAD_POLL_INTERVAL_MS = 60 * 1000;

type Listener = (count: number) => void;

class UnreadCountStore {
  private count = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  // A session change (sign in / out) must stop a poll loop that was started
  // for the previous identity.
  private identity: string | null = null;

  get(): number {
    return this.count;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.count);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.count);
    }
  }

  /** Overrides the count locally (mark-as-read zeroes the badge instantly). */
  set(count: number): void {
    const next = Math.max(0, Math.trunc(count));
    if (next === this.count) {
      return;
    }
    this.count = next;
    this.emit();
  }

  /** One fetch of the authoritative count. Swallows failures (stale is fine). */
  async refresh(): Promise<void> {
    try {
      const apiBase = getApiBaseUrl();
      const cookie = await authClient.getCookie();
      this.set(await fetchUnreadCount({ apiBase, cookie }));
    } catch {
      // Badge freshness is not worth surfacing an error for.
    }
  }

  /**
   * Starts polling for `identity` (the user id, or "guest" so the loop still
   * re-keys on sign-in). Idempotent per identity; call `stop` on sign-out.
   */
  start(identity: string | null): void {
    if (this.started && this.identity === identity) {
      return;
    }
    this.stop();
    this.started = true;
    this.identity = identity;
    // Guests have no notifications; skip the initial fetch and timer until a
    // signed-in identity arrives.
    if (!identity || identity === "guest") {
      this.set(0);
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, UNREAD_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.started = false;
    this.identity = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Marks everything read and zeroes the badge in one call. */
  async markAllRead(): Promise<void> {
    try {
      const apiBase = getApiBaseUrl();
      const cookie = await authClient.getCookie();
      await markAllNotificationsRead({ apiBase, cookie });
    } catch {
      // The optimistic zero below is still correct enough; the next poll heals.
    }
    this.set(0);
  }
}

/** Process-wide unread store used by the header and the notifications screen. */
export const unreadCountStore = new UnreadCountStore();
