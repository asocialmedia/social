// Bubble corner shaping for grouped messages.
//
// A run of consecutive messages from one sender reads as a single block. The
// corners facing INTO the run tighten so neighbours interlock -- the first message
// shapes its bottom thread-edge corner (facing down into the group), a middle
// message both, and the last shapes its top corner while keeping the tail on its
// bottom corner. Outer corners facing away from the run stay full. Only the thread
// edge is ever shaped.
//
// Web expresses this as a string of Tailwind radius classes. There is no
// stylesheet here, so this returns the four corner radii as numbers that the
// bubble composes straight into a StyleSheet -- same four shapes, same thread edge,
// testable without a renderer.

export type BubblePosition = "bottom" | "middle" | "solo" | "top";

export const BUBBLE_RADIUS = 16;
const TIGHT_RADIUS = 6;
const TAIL_RADIUS = 4;

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

export interface BubbleCorners {
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
}

// Own (right-aligned) messages shape the right edge; received (left-aligned)
// messages shape the left edge. The tail sits on the run's last row and on solo
// messages.
//
// Each switch covers all four positions with its `default` arm, because `default`
// IS the solo arm here and an unreachable fallback would be dead weight. If
// `BubblePosition` ever gains a variant, an explicit case must be added above the
// default rather than silently inheriting the solo shape.
export function bubbleCorners(
  position: BubblePosition,
  mine: boolean
): BubbleCorners {
  if (mine) {
    switch (position) {
      case "top": {
        return {
          borderBottomLeftRadius: BUBBLE_RADIUS,
          borderBottomRightRadius: TIGHT_RADIUS,
          borderTopLeftRadius: BUBBLE_RADIUS,
          borderTopRightRadius: BUBBLE_RADIUS,
        };
      }
      case "middle": {
        return {
          borderBottomLeftRadius: BUBBLE_RADIUS,
          borderBottomRightRadius: TIGHT_RADIUS,
          borderTopLeftRadius: BUBBLE_RADIUS,
          borderTopRightRadius: TIGHT_RADIUS,
        };
      }
      case "bottom": {
        // Tightened top corner meets the bubble above; the tail closes the run.
        return {
          borderBottomLeftRadius: BUBBLE_RADIUS,
          borderBottomRightRadius: TAIL_RADIUS,
          borderTopLeftRadius: BUBBLE_RADIUS,
          borderTopRightRadius: TIGHT_RADIUS,
        };
      }
      default: {
        return {
          borderBottomLeftRadius: BUBBLE_RADIUS,
          borderBottomRightRadius: TAIL_RADIUS,
          borderTopLeftRadius: BUBBLE_RADIUS,
          borderTopRightRadius: BUBBLE_RADIUS,
        };
      }
    }
  }
  switch (position) {
    case "top": {
      return {
        borderBottomLeftRadius: TIGHT_RADIUS,
        borderBottomRightRadius: BUBBLE_RADIUS,
        borderTopLeftRadius: BUBBLE_RADIUS,
        borderTopRightRadius: BUBBLE_RADIUS,
      };
    }
    case "middle": {
      return {
        borderBottomLeftRadius: TIGHT_RADIUS,
        borderBottomRightRadius: BUBBLE_RADIUS,
        borderTopLeftRadius: TIGHT_RADIUS,
        borderTopRightRadius: BUBBLE_RADIUS,
      };
    }
    case "bottom": {
      return {
        borderBottomLeftRadius: TAIL_RADIUS,
        borderBottomRightRadius: BUBBLE_RADIUS,
        borderTopLeftRadius: TIGHT_RADIUS,
        borderTopRightRadius: BUBBLE_RADIUS,
      };
    }
    default: {
      return {
        borderBottomLeftRadius: TAIL_RADIUS,
        borderBottomRightRadius: BUBBLE_RADIUS,
        borderTopLeftRadius: BUBBLE_RADIUS,
        borderTopRightRadius: BUBBLE_RADIUS,
      };
    }
  }
}
