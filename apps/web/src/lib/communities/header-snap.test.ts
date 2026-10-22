import { expect, test } from "bun:test";

import { attachCommunityHeaderSnap } from "./header-snap";

class ScrollViewport extends EventTarget {
  scrollTop = 0;
}

function setup(position = 0) {
  const viewport = new ScrollViewport();
  viewport.scrollTop = position;
  const interactionTarget = new EventTarget();
  const states: boolean[] = [];
  const dispose = attachCommunityHeaderSnap({
    interactionTarget,
    onCompactChange: (compact) => states.push(compact),
    viewport,
  });
  return { dispose, interactionTarget, states, viewport };
}

function wheel(deltaY: number, deltaX = 0, ctrlKey = false) {
  return Object.assign(new Event("wheel"), { ctrlKey, deltaX, deltaY });
}

function pointer(type: string, clientY: number) {
  return Object.assign(new Event(type), { clientY, pointerType: "touch" });
}

test("downward intent immediately requests the complete compact state", () => {
  const { dispose, states, viewport } = setup();
  try {
    viewport.dispatchEvent(wheel(1));
    expect(states).toEqual([false, true]);
    viewport.dispatchEvent(new Event("scrollend"));
    expect(states).toEqual([false, true]);
  } finally {
    dispose();
  }
});

test("continued scrolling through posts does not update the compact header", () => {
  const { dispose, states, viewport } = setup();
  try {
    viewport.dispatchEvent(wheel(20));
    for (const position of [20, 200, 900, 5000, 2000, 100]) {
      viewport.scrollTop = position;
      viewport.dispatchEvent(new Event("scroll"));
      viewport.dispatchEvent(wheel(position % 2 ? 10 : -10));
    }
    expect(states).toEqual([false, true]);
  } finally {
    dispose();
  }
});

test("upward intent expands only after returning to the top", () => {
  const { dispose, states, viewport } = setup(600);
  try {
    viewport.dispatchEvent(wheel(-30));
    expect(states).toEqual([true]);
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
    expect(states).toEqual([true]);
    viewport.dispatchEvent(wheel(-1));
    expect(states).toEqual([true, false]);
  } finally {
    dispose();
  }
});

test("pinch zoom and horizontal scrolling do not collapse the header", () => {
  const { dispose, states, viewport } = setup();
  try {
    viewport.dispatchEvent(wheel(10, 0, true));
    viewport.dispatchEvent(wheel(2, 20));
    expect(states).toEqual([false]);
  } finally {
    dispose();
  }
});

test("touch intent triggers a complete transition without waiting for release", () => {
  const { dispose, states, viewport, interactionTarget } = setup();
  try {
    viewport.dispatchEvent(pointer("pointerdown", 300));
    viewport.dispatchEvent(pointer("pointermove", 298));
    expect(states).toEqual([false]);
    viewport.dispatchEvent(pointer("pointermove", 290));
    expect(states).toEqual([false, true]);
    interactionTarget.dispatchEvent(pointer("pointercancel", 290));
    viewport.dispatchEvent(pointer("pointermove", 320));
    expect(states).toEqual([false, true]);
  } finally {
    dispose();
  }
});

test("keyboard navigation switches complete states immediately", () => {
  const { dispose, states, viewport } = setup();
  try {
    viewport.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "PageDown" })
    );
    viewport.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "ArrowUp" })
    );
    expect(states).toEqual([false, true, false]);
  } finally {
    dispose();
  }
});

test("scrollbar and programmatic navigation initialize a complete compact state", () => {
  const { dispose, states, viewport } = setup();
  try {
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event("scroll"));
    expect(states).toEqual([false, true]);
  } finally {
    dispose();
  }
});

test("disposal removes input handling and has no deferred snap work", () => {
  const { dispose, states, viewport } = setup();
  dispose();
  viewport.dispatchEvent(wheel(10));
  viewport.scrollTop = 20;
  viewport.dispatchEvent(new Event("scroll"));
  expect(states).toEqual([false]);
});

test("reattaching after a modal preserves a compact header even at scroll top zero", () => {
  const viewport = new ScrollViewport();
  const states: boolean[] = [];
  const dispose = attachCommunityHeaderSnap({
    initialCompact: true,
    interactionTarget: new EventTarget(),
    onCompactChange: (compact) => states.push(compact),
    viewport,
  });
  expect(states).toEqual([true]);
  dispose();
});
