export interface MessageFrame {
  y: number;
  height: number;
}

export function messageAtPoint(
  frames: Readonly<Record<string, MessageFrame>>,
  contentY: number
): string | null {
  "worklet";
  for (const id of Object.keys(frames)) {
    const frame = frames[id];
    if (frame && contentY >= frame.y && contentY < frame.y + frame.height) {
      return id;
    }
  }
  return null;
}

export function invertedContentY(
  screenY: number,
  viewportTop: number,
  viewportHeight: number,
  offset: number
): number {
  "worklet";
  return offset + viewportHeight - (screenY - viewportTop);
}

export function selectionRangeIds(
  messages: readonly { id: string }[],
  anchor: string,
  current: string
): string[] {
  const first = messages.findIndex((message) => message.id === anchor);
  const last = messages.findIndex((message) => message.id === current);
  if (first === -1 || last === -1) {
    return [];
  }
  return messages
    .slice(Math.min(first, last), Math.max(first, last) + 1)
    .map((message) => message.id);
}

// Rebuild from the hold-start snapshot, so reversing a drag restores prior ticks.
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

export function selectionScrollVelocity(
  fingerY: number,
  top: number,
  height: number
): number {
  "worklet";
  const edge = Math.min(56, height / 4);
  if (height <= 0 || edge <= 0) {
    return 0;
  }
  if (fingerY < top + edge) {
    return 360 * Math.min(1, Math.max(0, (top + edge - fingerY) / edge));
  }
  if (fingerY > top + height - edge) {
    return (
      -360 * Math.min(1, Math.max(0, (fingerY - top - height + edge) / edge))
    );
  }
  return 0;
}

export function shouldReply(distance: number, velocity: number): boolean {
  "worklet";
  return distance >= 56 || (distance >= 24 && velocity >= 800);
}

export function replyOffset(distance: number): number {
  "worklet";
  const positive = Math.max(0, distance);
  return positive <= 72
    ? positive
    : 72 + 16 * (1 - 1 / (1 + (positive - 72) / 72));
}
