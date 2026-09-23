// Pure geometry/policy for the message transcript gestures, kept out of the
// component so the rules are unit-tested and the DOM handlers stay thin.
//
// Desktop transcript contract (fine pointers only):
//   right click -> options pane, anchored beside the message
//   double click -> reply
//   drag (slide) -> toggle multi-select across rows
//   plain left click -> nothing (lets text selection work)
//
// Touch has one gesture: a tap opens the same options pane for that message.
// Nothing else is wired for coarse pointers, so the two input models never
// overlap.

// A pointer must travel this far before a press counts as a drag/scroll rather
// than a click. Small enough to feel instant, large enough to absorb the jitter
// of a normal click.
export const GESTURE_SLOP_PX = 8;

export interface Point {
  x: number;
  y: number;
}

export function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// Whether the pointer has moved past the click/drag threshold.
export function exceededSlop(
  start: Point,
  current: Point,
  slop = GESTURE_SLOP_PX
): boolean {
  return distanceSquared(start, current) > slop * slop;
}

// Inclusive list of row indices spanned by a selection drag, order-independent.
export function selectionRange(
  anchorIndex: number,
  currentIndex: number
): number[] {
  const lo = Math.min(anchorIndex, currentIndex);
  const hi = Math.max(anchorIndex, currentIndex);
  const indices: number[] = [];
  for (let index = lo; index <= hi; index += 1) {
    indices.push(index);
  }
  return indices;
}

// Applies a drag range to a snapshot of the selection taken when the drag
// started. `mode` is decided once, from the row the drag began on: starting on
// an unselected row selects the range, starting on a selected row clears it, so
// dragging back over already-selected messages unselects them. Rebuilding from
// the snapshot (rather than mutating the live set) means dragging outside the
// anchor range restores rows the earlier range had touched.
export function applySelectionRange(
  base: ReadonlySet<string>,
  ids: readonly string[],
  mode: "add" | "remove"
): ReadonlySet<string> {
  const next = new Set(base);
  for (const id of ids) {
    if (mode === "add") {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

// The drag intent for a press: clearing an already-selected row, otherwise
// selecting. Read once at pointerdown so a drag never flips modes mid-gesture.
export function dragSelectionMode(
  selected: ReadonlySet<string>,
  messageId: string
): "add" | "remove" {
  return selected.has(messageId) ? "remove" : "add";
}

// Clamps a floating menu position so the panel cannot overflow the viewport on
// the right or bottom edge. `width`/`height` are the panel's measured size;
// without a measurement yet, callers pass the anchor unchanged.
export function clampToViewport(
  point: Point,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8
): Point {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.min(Math.max(point.x, margin), maxX),
    y: Math.min(Math.max(point.y, margin), maxY),
  };
}

export interface PaneRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

// Places the options pane beside a message bubble. `preferEnd` means the pane
// should sit to the LEFT of the bubble (own/sender messages), otherwise to its
// right (received messages). The preferred side is used when it fits; if it
// does not, the pane flips to the other side; if neither fits (a narrow phone
// where the bubble spans most of the width), it falls back to a clamped
// position so it stays fully on-screen. Vertical is always clamped. Pure so the
// flip-then-clamp behavior is unit-tested apart from the DOM.
export function placeOptionsPane(input: {
  gap?: number;
  margin?: number;
  preferEnd: boolean;
  rect: PaneRect;
  size: { height: number; width: number };
  viewport: { height: number; width: number };
}): Point {
  const gap = input.gap ?? 8;
  const margin = input.margin ?? 8;
  const { rect, size, viewport } = input;

  const leftOf = rect.left - gap - size.width;
  const rightOf = rect.right + gap;
  const fitsLeftOf = leftOf >= margin;
  const fitsRightOf = rightOf + size.width <= viewport.width - margin;

  let x: number;
  if (input.preferEnd) {
    // Panel to the left of the bubble; flip right when there is no room.
    x = fitsLeftOf ? leftOf : rightOf;
  } else {
    x = fitsRightOf ? rightOf : leftOf;
  }

  const y = rect.top;
  // Final safety net: clamp whichever side was chosen so an oversized panel or a
  // viewport narrower than the panel can never overshoot.
  return clampToViewport({ x, y }, size, viewport, margin);
}
