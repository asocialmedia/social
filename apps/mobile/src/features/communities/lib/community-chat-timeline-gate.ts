// Gate for the community timeline's pin-to-latest snap.
// The list snaps to offset 0 on every content-size change while the reader is
// at the live tail, which is what keeps a busy channel pinned as messages
// arrive. An unconditional snap also fires while the reader is scrolling up
// (a size change from a mounting image lands between scroll events), yanking
// them back to the bottom so the channel feels like it cannot be scrolled.
// The snap is only harmless when the last known offset is already at the
// bottom and the finger is not down, so gate it on both.
export interface TimelineSnapGate {
  // True while the finger is down on the list.
  dragging: boolean;
  // Latest onScroll offset (0 is the live tail on the inverted list).
  lastOffsetY: number;
  // When the latest scroll event arrived, to cover the throttle gap where the
  // offset is stale because the finger just started a fast fling.
  lastScrollAtMs: number;
  nowMs: number;
}

// Offset 0 is the live tail; a few points of slack keep the snap a no-op for
// a reader resting at the bottom. A recent scroll event means the offset may
// be stale (the reader just started moving), so hold the snap briefly.
const AT_LIVE_TAIL_PX = 8;
const SETTLED_MS = 350;

export function shouldSnapTimelineToLatest(gate: TimelineSnapGate): boolean {
  if (gate.dragging) {
    return false;
  }
  if (gate.lastOffsetY > AT_LIVE_TAIL_PX) {
    return false;
  }
  return gate.nowMs - gate.lastScrollAtMs > SETTLED_MS;
}
