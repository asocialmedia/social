// Bubble corner shaping for grouped messages.
//
// A run of consecutive messages from one sender reads as a single block. The
// corners facing INTO the run tighten so neighbours interlock — the first
// message shapes its bottom thread-edge corner (facing down into the group),
// a middle message both, and the last shapes its top corner while keeping the
// tail on its bottom corner. Outer corners facing away from the run stay full.
// Only the thread edge is ever shaped. Pure so every position is unit-tested
// apart from rendering.
//
//   solo    one message in its group     -> fully rounded (plus the tail)
//   top     first of several             -> bottom edge corner tightened
//   middle  neither first nor last       -> both edge corners tightened
//   bottom  last of several              -> top edge corner tightened (plus tail)

export type BubblePosition = "solo" | "top" | "middle" | "bottom";

export function bubblePosition(
  isFirstInGroup: boolean,
  isLastInGroup: boolean
): BubblePosition {
  if (isFirstInGroup && isLastInGroup) {
    return "solo";
  }
  if (isFirstInGroup) {
    return "top";
  }
  if (isLastInGroup) {
    return "bottom";
  }
  return "middle";
}

// Corner-radius classes for a text/post bubble. Own (right-aligned) messages
// shape the right edge; received (left-aligned) messages shape the left edge.
// The tail sits on the run's last row and on solo messages. Media albums are
// not passed here — they draw their own frames.
export function bubbleRoundingClasses(
  position: BubblePosition,
  mine: boolean
): string {
  if (mine) {
    switch (position) {
      case "top": {
        return "rounded-2xl rounded-br-md";
      }
      case "middle": {
        return "rounded-2xl rounded-tr-md rounded-br-md";
      }
      case "bottom": {
        // Tightened top corner meets the bubble above; the tail closes the run.
        return "rounded-2xl rounded-tr-md rounded-br-sm";
      }
      case "solo": {
        return "rounded-2xl rounded-br-sm";
      }
      default: {
        // Unreachable: BubblePosition is a closed union. Falls back to the
        // solo shape rather than an unrounded bubble if it ever drifts.
        return "rounded-2xl rounded-br-sm";
      }
    }
  }
  switch (position) {
    case "top": {
      return "rounded-2xl rounded-bl-md";
    }
    case "middle": {
      return "rounded-2xl rounded-tl-md rounded-bl-md";
    }
    case "bottom": {
      // Tightened top corner meets the bubble above; the tail closes the run.
      return "rounded-2xl rounded-tl-md rounded-bl-sm";
    }
    case "solo": {
      return "rounded-2xl rounded-bl-sm";
    }
    default: {
      return "rounded-2xl rounded-bl-sm";
    }
  }
}
