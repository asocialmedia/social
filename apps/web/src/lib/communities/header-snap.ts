interface HeaderSnapViewport extends EventTarget {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollTo: (options: ScrollToOptions) => void;
}

const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

export function attachCommunityHeaderSnap({
  viewport,
  interactionTarget,
  getHeaderHeight,
  reducedMotion,
  supportsScrollEnd,
}: {
  viewport: HeaderSnapViewport;
  interactionTarget: EventTarget;
  getHeaderHeight: () => number;
  reducedMotion: boolean;
  supportsScrollEnd: boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapping = false;
  const pointers = new Set<number>();
  const keys = new Set<string>();
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const settle = () => {
    clearTimer();
    snapping = false;
    if (pointers.size || keys.size) {
      return;
    }
    const height = getHeaderHeight();
    const position = viewport.scrollTop;
    if (height <= 0 || position <= 1 || position >= height - 1) {
      return;
    }
    // Only settle inside the header's transition range; reading posts stays free.
    const target = position < height / 2 ? 0 : height;
    if (target > viewport.scrollHeight - viewport.clientHeight) {
      return;
    }
    snapping = true;
    viewport.scrollTo({
      behavior: reducedMotion ? "instant" : "smooth",
      top: target,
    });
  };
  const schedule = () => {
    clearTimer();
    if (!supportsScrollEnd) {
      timer = setTimeout(settle, 160);
    }
  };
  const interrupt = () => {
    clearTimer();
    if (snapping) {
      snapping = false;
      viewport.scrollTo({ behavior: "instant", top: viewport.scrollTop });
    }
  };
  const pointerDown = (event: Event) => {
    pointers.add((event as PointerEvent).pointerId);
    interrupt();
  };
  const pointerUp = (event: Event) => {
    if (pointers.delete((event as PointerEvent).pointerId)) {
      schedule();
    }
  };
  const keyDown = (event: Event) => {
    const { key } = event as KeyboardEvent;
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      target?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
    ) {
      return;
    }
    if (SCROLL_KEYS.has(key)) {
      keys.add(key);
      interrupt();
    }
  };
  const keyUp = (event: Event) => {
    if (keys.delete((event as KeyboardEvent).key)) {
      schedule();
    }
  };
  const blur = () => {
    pointers.clear();
    keys.clear();
    interrupt();
  };
  viewport.addEventListener("scroll", schedule, { passive: true });
  viewport.addEventListener("scrollend", settle);
  viewport.addEventListener("pointerdown", pointerDown, { passive: true });
  viewport.addEventListener("wheel", interrupt, { passive: true });
  viewport.addEventListener("keydown", keyDown);
  interactionTarget.addEventListener("pointerup", pointerUp, { passive: true });
  interactionTarget.addEventListener("pointercancel", pointerUp, {
    passive: true,
  });
  interactionTarget.addEventListener("keyup", keyUp);
  interactionTarget.addEventListener("blur", blur);
  return () => {
    interrupt();
    viewport.removeEventListener("scroll", schedule);
    viewport.removeEventListener("scrollend", settle);
    viewport.removeEventListener("pointerdown", pointerDown);
    viewport.removeEventListener("wheel", interrupt);
    viewport.removeEventListener("keydown", keyDown);
    interactionTarget.removeEventListener("pointerup", pointerUp);
    interactionTarget.removeEventListener("pointercancel", pointerUp);
    interactionTarget.removeEventListener("keyup", keyUp);
    interactionTarget.removeEventListener("blur", blur);
  };
}
