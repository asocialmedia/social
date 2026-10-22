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

function wheelScroll(viewport: ScrollViewport, position: number) {
  viewport.dispatchEvent(new Event("wheel"));
  viewport.scrollTop = position;
  viewport.dispatchEvent(new Event("scroll"));
}

test("scroll completion settles either side of the header midpoint smoothly", async () => {
  const { dispose, viewport } = setup();
  try {
    wheelScroll(viewport, 80);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests.at(-1)).toEqual({ behavior: "smooth", top: 0 });
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests.at(-1)).toEqual({ behavior: "smooth", top: 240 });
  } finally {
    dispose();
  }
});

test("post reading, settled endpoints, overscroll, and unreachable destinations do not snap", () => {
  const { dispose, viewport } = setup();
  try {
    for (const position of [-12, 0, 0.5, 240, 241, 900]) {
      wheelScroll(viewport, position);
      viewport.dispatchEvent(new Event("scrollend"));
    }
    viewport.scrollHeight = 800;
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([]);
  } finally {
    dispose();
  }
});

test("a held touch prevents snapping until the gesture is released", async () => {
  const { dispose, interactionTarget, viewport } = setup();
  try {
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(pointer("pointerdown"));
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([]);
    interactionTarget.dispatchEvent(pointer("pointerup"));
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  } finally {
    dispose();
  }
});

test("fresh wheel input cancels an active snap at the current scroll position", async () => {
  const { dispose, viewport } = setup();
  try {
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    viewport.scrollTop = 170;
    viewport.dispatchEvent(new Event("wheel"));
    expect(viewport.requests.at(-1)).toEqual({ behavior: "instant", top: 170 });
  } finally {
    dispose();
  }
});

test("reduced motion settles instantly", async () => {
  const { dispose, viewport } = setup({ reducedMotion: true });
  try {
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests).toEqual([{ behavior: "instant", top: 240 }]);
  } finally {
    dispose();
  }
});

test("older browsers settle after idle and cleanup cancels pending work", async () => {
  const { dispose, viewport } = setup({ supportsScrollEnd: false });
  wheelScroll(viewport, 150);
  await Bun.sleep(190);
  expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  viewport.requests.length = 0;
  viewport.dispatchEvent(new Event("scroll"));
  dispose();
  viewport.requests.length = 0;
  await Bun.sleep(190);
  expect(viewport.requests).toEqual([]);
});

test("keyboard scrolling cannot snap while a navigation key is held", async () => {
  const { dispose, interactionTarget, viewport } = setup();
  try {
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "ArrowDown" })
    );
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toEqual([]);
    interactionTarget.dispatchEvent(
      Object.assign(new Event("keyup"), { key: "ArrowDown" })
    );
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  } finally {
    dispose();
  }
});

test("cancelling a snap cannot restart it from the cancellation scrollend event", async () => {
  const { dispose, viewport } = setup();
  try {
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    viewport.scrollTop = 170;
    viewport.dispatchEvent(new Event("wheel"));
    const requestCount = viewport.requests.length;
    viewport.dispatchEvent(new Event("scrollend"));
    viewport.dispatchEvent(new Event("scrollend"));
    expect(viewport.requests).toHaveLength(requestCount);
    viewport.scrollTop = 110;
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests.at(-1)).toEqual({ behavior: "smooth", top: 0 });
  } finally {
    dispose();
  }
});

test("programmatic scrolling and snap-generated frames never arm another snap", async () => {
  const { dispose, viewport } = setup({ supportsScrollEnd: false });
  try {
    viewport.scrollTop = 150;
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(190);
    expect(viewport.requests).toEqual([]);
    wheelScroll(viewport, 150);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    for (const position of [170, 195, 220]) {
      viewport.scrollTop = position;
      viewport.dispatchEvent(new Event("scroll"));
    }
    viewport.dispatchEvent(new Event("scrollend"));
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(190);
    expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  } finally {
    dispose();
  }
});

test("brief gaps between trackpad inputs do not repeatedly start and cancel snapping", async () => {
  const { dispose, viewport } = setup();
  try {
    wheelScroll(viewport, 140);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(30);
    wheelScroll(viewport, 170);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(30);
    expect(viewport.requests).toEqual([]);
    wheelScroll(viewport, 190);
    viewport.dispatchEvent(new Event("scrollend"));
    await Bun.sleep(150);
    expect(viewport.requests).toEqual([{ behavior: "smooth", top: 240 }]);
  } finally {
    dispose();
  }
});
