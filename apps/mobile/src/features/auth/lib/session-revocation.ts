// Event-driven session revocation parser and matching rules for the native app.
// Matches the server contract in packages/db (session-events) and web's
// session-revocation-guard.

export interface SessionRevocationEvent {
  kind: "session.revoked";
  retainedSessionId?: string;
  revokedSessionId?: string;
}

// Validates an SSE payload from the /api/auth/session-events endpoint.
// Accepts either a raw JSON string or an already parsed object.
export function parseSessionRevocationEvent(
  value?: unknown
): SessionRevocationEvent | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.kind !== "session.revoked") {
    return null;
  }
  if (
    (candidate.retainedSessionId !== undefined &&
      typeof candidate.retainedSessionId !== "string") ||
    (candidate.revokedSessionId !== undefined &&
      typeof candidate.revokedSessionId !== "string") ||
    (candidate.retainedSessionId !== undefined &&
      candidate.revokedSessionId !== undefined)
  ) {
    return null;
  }
  return candidate as unknown as SessionRevocationEvent;
}

// Determines whether the revocation event targets the active session id.
// If revokedSessionId is specified, only that session is ended.
// If retainedSessionId is specified, all sessions except that one are ended.
// If neither is specified, all sessions are ended.
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

// Builds the full SSE stream endpoint URL for session events.
export function buildSessionEventsUrl(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/auth/session-events`;
}
