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

export default function SessionRevocationGuard({
  currentSessionId,
}: {
  currentSessionId: string;
}) {
  useEffect(() => {
    const eventSource = new EventSource("/api/auth/session-events");

    const handleSessionRevocation = (message: Event) => {
      if (
        !(message instanceof MessageEvent) ||
        typeof message.data !== "string"
      ) {
        return;
      }
      const event = parseSessionRevocationEvent(message.data);
      if (event && shouldEndSession(event, currentSessionId)) {
        eventSource.close();
        window.location.replace("/login?reason=session-ended");
      }
    };

    eventSource.addEventListener("session-revoked", handleSessionRevocation);
    return () => {
      eventSource.removeEventListener(
        "session-revoked",
        handleSessionRevocation
      );
      eventSource.close();
    };
  }, [currentSessionId]);

  return null;
}
