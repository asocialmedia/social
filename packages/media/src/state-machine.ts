// Lifecycle state machine. Every status change in the pipeline goes through
// assertTransition so invalid jumps (e.g. UPLOADING -> READY, skipping scan)
// are impossible by construction.

import type { MediaStatus } from "./types";

const TRANSITIONS: Record<MediaStatus, readonly MediaStatus[]> = {
  // READY -> PROCESSING supports reprocessing under a newer pipeline version.
  DELETED: [],
  FAILED: ["QUARANTINED", "PROCESSING", "REJECTED", "DELETED"],
  PROCESSING: ["READY", "FAILED", "REJECTED", "DELETED"],
  QUARANTINED: ["SCANNING", "DELETED"],
  READY: ["PROCESSING", "DELETED"],
  REJECTED: ["DELETED"],
  SCANNING: ["PROCESSING", "REJECTED", "FAILED", "DELETED"],
  UPLOADING: ["QUARANTINED", "DELETED"],
};

export function canTransition(from: MediaStatus, to: MediaStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: MediaStatus): readonly MediaStatus[] {
  return TRANSITIONS[from];
}

export function isTerminalStatus(status: MediaStatus): boolean {
  if (status === "DELETED") {
    return true;
  }
  // REJECTED only flows to DELETED, so nothing else may mutate the row.
  return status === "REJECTED";
}

export class InvalidTransitionError extends Error {
  override name = "InvalidTransitionError";
  readonly from: MediaStatus;
  readonly to: MediaStatus;

  constructor(from: MediaStatus, to: MediaStatus) {
    super(`Invalid media transition: ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: MediaStatus, to: MediaStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

// Statuses from which a media row may still be attached to a new post.
// Rejected and deleted rows must never be claimable.
export const CLAIMABLE_STATUSES: readonly MediaStatus[] = [
  "UPLOADING",
  "QUARANTINED",
  "SCANNING",
  "PROCESSING",
  "READY",
];
