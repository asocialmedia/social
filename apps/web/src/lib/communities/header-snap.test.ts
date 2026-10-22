import { expect, test } from "bun:test";

import { attachCommunityHeaderSnap } from "./header-snap";

class ScrollViewport extends EventTarget {
  scrollTop = 0;
  scrollHeight = 2000;
  clientHeight = 700;
  requests: ScrollToOptions[] = [];
  scrollTo = (options: ScrollToOptions) => {
    this.requests.push(options);
  };
}

function setup({ reducedMotion = false, supportsScrollEnd = true } = {}) {
  const viewport = new ScrollViewport();
  const interactionTarget = new EventTarget();
  const dispose = attachCommunityHeaderSnap({
    getHeaderHeight: () => 240,
    interactionTarget,
    reducedMotion,
    supportsScrollEnd,
    viewport,
  });
  return { dispose, interactionTarget, viewport };
}

function pointer(type: string) {
  return Object.assign(new Event(type), { pointerId: 1 });
}

test("scroll completion settles either side of the header midpoint smoothly", () => {
  const { dispose, viewport } = setup();
  try {
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests.at(-1)).toEqual({ behavior: "smooth", top: 0 });
    viewport.scrollTop = 150;
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests.at(-1)).toEqual({ behavior: "smooth", top: 240 });
  } finally {
    dispose();
  }
});

test("post reading, settled endpoints, overscroll, and unreachable destinations do not snap", () => {
  const { dispose, viewport } = setup();
  try {
    for (const position of [-12, 0, 0.5, 240, 241, 900]) {
      viewport.scrollTop = position;
      viewport.dispatchEvent(new Event("scrollend"));
    }
    viewport.scrollHeight = 800;
    viewport.scrollTop = 150;
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([]);
  } finally {
    dispose();
  }
});

test("a held touch prevents snapping until the gesture is released", () => {
  const { dispose, interactionTarget, viewport } = setup();
  try {
    viewport.scrollTop = 150;
    viewport.dispatchEvent(pointer("pointerdown"));
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([]);
    interactionTarget.dispatchEvent(pointer("pointerup"));
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  } finally {
    dispose();
  }
});

test("fresh wheel input cancels an active snap at the current scroll position", () => {
  const { dispose, viewport } = setup();
  try {
    viewport.scrollTop = 150;
    viewport.dispatchEvent(new Event("scrollend"));
    viewport.scrollTop = 170;
    viewport.dispatchEvent(new Event("wheel"));
    expect(viewport.requests.at(-1)).toEqual({ behavior: "instant", top: 170 });
  } finally {
    dispose();
  }
});

test("reduced motion settles instantly", () => {
  const { dispose, viewport } = setup({ reducedMotion: true });
  try {
    viewport.scrollTop = 150;
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([{ behavior: "instant", top: 240 }]);
  } finally {
    dispose();
  }
});

test("older browsers settle after idle and cleanup cancels pending work", async () => {
  const { dispose, viewport } = setup({ supportsScrollEnd: false });
  viewport.scrollTop = 150;
  viewport.dispatchEvent(new Event("scroll"));
  await Bun.sleep(190);
  expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  viewport.requests.length = 0;
  viewport.dispatchEvent(new Event("scroll"));
  dispose();
  viewport.requests.length = 0;
  await Bun.sleep(190);
  expect(viewport.requests).toEqual([]);
});

test("keyboard scrolling cannot snap while a navigation key is held", () => {
  const { dispose, interactionTarget, viewport } = setup();
  try {
    viewport.scrollTop = 150;
    viewport.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "ArrowDown" })
    );
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([]);
    interactionTarget.dispatchEvent(
      Object.assign(new Event("keyup"), { key: "ArrowDown" })
    );
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  } finally {
    dispose();
  }
});
