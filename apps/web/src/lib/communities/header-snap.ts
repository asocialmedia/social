interface HeaderViewport extends EventTarget {
  scrollTop: number;
}

export function attachCommunityHeaderSnap({
  viewport,
  interactionTarget,
  initialCompact = viewport.scrollTop > 2,
  onCompactChange,
}: {
  viewport: HeaderViewport;
  interactionTarget: EventTarget;
  initialCompact?: boolean;
  onCompactChange: (compact: boolean) => void;
}) {
  let compact = initialCompact;
  let touchY: number | null = null;
  onCompactChange(compact);
  const change = (next: boolean) => {
    if (compact !== next) {
      compact = next;
      onCompactChange(next);
    }
  };
  const intent = (down: boolean) => {
    if (down) {
      change(true);
    } else if (viewport.scrollTop <= 1) {
      change(false);
    }
  };
  const wheel = (event: Event) => {
    const wheelEvent = event as WheelEvent;
    if (
      wheelEvent.ctrlKey ||
      Math.abs(wheelEvent.deltaY) <= Math.abs(wheelEvent.deltaX)
    ) {
      return;
    }
    intent(wheelEvent.deltaY > 0);
  };
  const pointerDown = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === "touch" || pointer.pointerType === "pen") {
      touchY = pointer.clientY;
    }
  };
  const pointerMove = (event: Event) => {
    if (touchY === null) {
      return;
    }
    const y = (event as PointerEvent).clientY;
    if (Math.abs(y - touchY) >= 6) {
      intent(y < touchY);
      touchY = y;
    }
  };
  const pointerUp = () => {
    touchY = null;
  };
  const keyDown = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      target?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
        target?.tagName ?? ""
      )
    ) {
      return;
    }
    if (["ArrowDown", "PageDown", "End", " "].includes(keyboard.key)) {
      intent(!(keyboard.key === " " && keyboard.shiftKey));
    } else if (["ArrowUp", "PageUp", "Home"].includes(keyboard.key)) {
      intent(false);
    }
  };
  const scroll = () => {
    if (viewport.scrollTop > 2) {
      change(true);
    }
  };
  viewport.addEventListener("wheel", wheel, { passive: true });
  viewport.addEventListener("pointerdown", pointerDown, { passive: true });
  viewport.addEventListener("pointermove", pointerMove, { passive: true });
  viewport.addEventListener("keydown", keyDown);
  viewport.addEventListener("scroll", scroll, { passive: true });
  interactionTarget.addEventListener("pointerup", pointerUp, { passive: true });
  interactionTarget.addEventListener("pointercancel", pointerUp, {
    passive: true,
  });
  interactionTarget.addEventListener("blur", pointerUp);
  return () => {
    viewport.removeEventListener("wheel", wheel);
    viewport.removeEventListener("pointerdown", pointerDown);
    viewport.removeEventListener("pointermove", pointerMove);
    viewport.removeEventListener("keydown", keyDown);
    viewport.removeEventListener("scroll", scroll);
    interactionTarget.removeEventListener("pointerup", pointerUp);
    interactionTarget.removeEventListener("pointercancel", pointerUp);
    interactionTarget.removeEventListener("blur", pointerUp);
  };
}
