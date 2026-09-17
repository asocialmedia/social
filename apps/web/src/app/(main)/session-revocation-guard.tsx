"use client";

import { useEffect } from "react";

interface SessionRevocationEvent {
  kind: "session.revoked";
  retainedSessionId?: string;
  revokedSessionId?: string;
}

export function parseSessionRevocationEvent(
  raw: string
): SessionRevocationEvent | null {
  try {
    const event = JSON.parse(raw) as Partial<SessionRevocationEvent>;
    if (event.kind !== "session.revoked") {
      return null;
    }
    if (
      (event.retainedSessionId !== undefined &&
        typeof event.retainedSessionId !== "string") ||
      (event.revokedSessionId !== undefined &&
        typeof event.revokedSessionId !== "string") ||
      (event.retainedSessionId !== undefined &&
        event.revokedSessionId !== undefined)
    ) {
      return null;
    }
    return event as SessionRevocationEvent;
  } catch {
    return null;
  }
}

export function shouldEndSession(
  event: SessionRevocationEvent,
  currentSessionId: string
): boolean {
  if (event.revokedSessionId) {
    return event.revokedSessionId === currentSessionId;
  }
  if (event.retainedSessionId) {
    return event.retainedSessionId !== currentSessionId;
  }
  return true;
}

type SessionEventSource = Pick<
  EventSource,
  "addEventListener" | "close" | "removeEventListener"
>;

// One shared stream per tab. Mounting a fresh EventSource per guard instance
// (and per StrictMode/HMR remount) aborts an in-flight request every time,
// which Firefox reports as an interrupted connection. The grace period lets a
// synchronous remount reuse the live stream; only a genuine unmount closes it.
// Listeners stay per-component so each mount still evaluates revocations
// against its own session id.
export function createSharedSessionEvents(
  factory: (url: string) => SessionEventSource,
  graceMs = 1000
) {
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let refs = 0;
  let source: SessionEventSource | null = null;

  return {
    acquire(): SessionEventSource {
      refs += 1;
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (!source) {
        source = factory("/api/auth/session-events");
      }
      return source;
    },
    release(): void {
      refs = Math.max(0, refs - 1);
      if (refs > 0 || closeTimer || !source) {
        return;
      }
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (refs === 0) {
          source?.close();
          source = null;
        }
      }, graceMs);
    },
  };
}

const sharedSessionEvents = createSharedSessionEvents(
  (url) => new EventSource(url)
);

export default function SessionRevocationGuard({
  currentSessionId,
}: {
  currentSessionId: string;
}) {
  useEffect(() => {
    const eventSource = sharedSessionEvents.acquire();

    const handleSessionRevocation = (message: Event) => {
      if (
        !(message instanceof MessageEvent) ||
        typeof message.data !== "string"
      ) {
        return;
      }
      const event = parseSessionRevocationEvent(message.data);
      if (event && shouldEndSession(event, currentSessionId)) {
        sharedSessionEvents.release();
        window.location.replace("/login?reason=session-ended");
      }
    };

    eventSource.addEventListener("session-revoked", handleSessionRevocation);
    return () => {
      eventSource.removeEventListener(
        "session-revoked",
        handleSessionRevocation
      );
      sharedSessionEvents.release();
    };
  }, [currentSessionId]);

  return null;
}
