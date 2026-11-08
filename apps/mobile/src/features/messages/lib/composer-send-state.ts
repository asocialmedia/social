// Explicit send state for the DM composer. A single `sending` boolean lets two
// rapid Enter presses both pass the `!sending` guard before the first commit
// lands, double-sending the draft; and a failure collapses back to "idle", so
// the draft looks unsent rather than retryable. This union makes the gate
// explicit: a send starts only from `idle` or `failed`, and a failure keeps
// the clientId + error so the composer can offer a retry instead of silently
// holding the text.

export type ComposerSendState =
  | { kind: "idle" }
  | { kind: "sending"; clientId: string }
  | { kind: "failed"; clientId: string; error: string };

export function idleSendState(): ComposerSendState {
  return { kind: "idle" };
}

// Whether a send may start from this state. `sending` never starts another.
export function canStartSend(state: ComposerSendState): boolean {
  return state.kind === "idle" || state.kind === "failed";
}

// Builds the `sending` state for a new attempt. Callers must check
// `canStartSend` first; this throws when the state forbids it so a missed
// guard fails loudly instead of double-sending.
export function beginSend(
  state: ComposerSendState,
  clientId: string
): ComposerSendState {
  if (!canStartSend(state)) {
    throw new Error("Cannot start a send while another is in flight");
  }
  return { clientId, kind: "sending" };
}

export function failSend(clientId: string, error: string): ComposerSendState {
  return { clientId, error, kind: "failed" };
}

// True when this completion belongs to the in-flight attempt; a stale settle
// from a previous attempt must not clear a newer send.
export function isCurrentSend(
  state: ComposerSendState,
  clientId: string
): boolean {
  return state.kind !== "idle" && state.clientId === clientId;
}
