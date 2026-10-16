export interface MediaBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

// Release suppression follows the gesture, even if a finger stays down for seconds.
export function createMediaHoldGesture(
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- a cancellable gesture timer deliberately accepts a callback.
  schedule = (callback: () => void) => {
    const timer = setTimeout(callback, 350);
    return () => clearTimeout(timer);
  },
  now = Date.now
) {
  let pending: { id: number; x: number; y: number; cancel: () => void } | null =
    null;
  let heldPointer: number | null = null;
  let suppressUntil = 0;
  const cancel = () => {
    pending?.cancel();
    pending = null;
  };
  return {
    cancel,
    interrupt() {
      cancel();
      if (heldPointer !== null) {
        suppressUntil = now() + 750;
      }
      heldPointer = null;
    },
    isPending: () => pending !== null,
    move(id: number, x: number, y: number) {
      if (pending?.id === id && Math.hypot(x - pending.x, y - pending.y) > 10) {
        cancel();
      }
    },
    release(id: number) {
      if (pending?.id === id) {
        cancel();
      }
      if (heldPointer === id) {
        heldPointer = null;
        suppressUntil = now() + 750;
      }
    },
    start(id: number, x: number, y: number, open: () => void) {
      cancel();
      if (heldPointer !== null) {
        return;
      }
      suppressUntil = 0;
      pending = {
        cancel: schedule(() => {
          pending = null;
          heldPointer = id;
          open();
        }),
        id,
        x,
        y,
      };
    },
    suppressClick: () => heldPointer !== null || now() < suppressUntil,
  };
}

export function findHeldMedia(
  target: Element,
  media: readonly { id: string }[]
) {
  if (target.closest('[role="dialog"], [data-media-control]')) {
    return null;
  }
  const element =
    target.closest("img,video") ??
    target.closest("button,[role=button]")?.querySelector("img,video");
  if (!element) {
    return null;
  }
  const sources = [
    element.getAttribute("src"),
    element.getAttribute("poster"),
    element.querySelector("source")?.getAttribute("src"),
  ].filter(Boolean);
  const index = media.findIndex((item) =>
    sources.some((source) => source?.includes(item.id))
  );
  return index === -1 ? null : { element, index };
}
