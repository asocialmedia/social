// oxlint-disable promise/prefer-await-to-callbacks -- Browser API mocks intentionally capture synchronous callbacks.
import { afterEach, beforeEach, expect, test } from "bun:test";

import { Window } from "happy-dom";

import { initialiseAboutMotion } from "./about-motion";

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let motionAllowed = true;
let timelineSupported = true;
let preferenceChange: (() => void) | undefined;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  dom = new Window();
  motionAllowed = true;
  timelineSupported = true;
  frames.clear();
  const preference = {
    addEventListener: (_event: string, callback: () => void) => {
      preferenceChange = callback;
    },
    get matches() {
      return motionAllowed;
    },
    removeEventListener: () => {
      preferenceChange = undefined;
    },
  };
  Object.defineProperty(dom, "matchMedia", { value: () => preference });
  for (const [name, value] of Object.entries({
    CSS: { supports: () => timelineSupported },
    HTMLElement: dom.HTMLElement,
    IntersectionObserver: undefined,
    ResizeObserver: undefined,
    cancelAnimationFrame: (id: number) => frames.delete(id),
    document: dom.document,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set((frameId += 1), callback);
      return frameId;
    },
    window: dom,
  })) {
    originalGlobals.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name)
    );
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  }
});

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
  originalGlobals.clear();
  dom.happyDOM.abort();
});

function makePage() {
  dom.document.body.innerHTML =
    '<div data-about-page><div data-stagger><div></div><div></div></div><span data-reveal="rule"></span><span class="experience-key"></span></div>';
  const page = dom.document.querySelector("[data-about-page]");
  if (!page) {
    throw new Error("Missing motion fixture");
  }
  return page;
}

function makeNetworkPage(contentWidth: number) {
  const page = makePage();
  page.insertAdjacentHTML(
    "beforeend",
    '<section id="about-networks"><div class="network-view"><ol class="network-track"></ol></div></section>'
  );
  const section = page.querySelector("#about-networks");
  const view = page.querySelector(".network-view");
  const track = page.querySelector(".network-track");
  if (!section || !view || !track) {
    throw new Error("Missing network fixture");
  }
  Object.defineProperty(view, "clientWidth", { value: 1000 });
  Object.defineProperty(track, "scrollWidth", { value: contentWidth });
  return { page, section };
}

test("the network track has reading time beyond its travel and holds its final panel before unpinning", () => {
  const { page, section } = makeNetworkPage(2200);
  const dispose = initialiseAboutMotion(page);
  try {
    const travel = Number(
      section.style.getPropertyValue("--about-networks-run").replace("px", "")
    );
    const distance = Number(
      section.style
        .getPropertyValue("--about-networks-scroll-distance")
        .replace("px", "")
    );
    const space = Number(
      section.style
        .getPropertyValue("--about-networks-scroll-space")
        .replace("px", "")
    );
    expect(travel).toBe(1200);
    expect(distance).toBeGreaterThan(travel);
    expect(space).toBeGreaterThan(distance);
  } finally {
    dispose();
  }
});

test("a network track that fits does not reserve empty scrolling space", () => {
  const { page, section } = makeNetworkPage(600);
  const dispose = initialiseAboutMotion(page);
  expect(section.style.getPropertyValue("--about-networks-run")).toBe("0px");
  expect(section.style.getPropertyValue("--about-networks-scroll-space")).toBe(
    "0px"
  );
  dispose();
});

test("reduced motion and browsers without scroll timelines retain the static page", () => {
  const page = makePage();
  motionAllowed = false;
  const disposeReduced = initialiseAboutMotion(page);
  expect(page.dataset.motionEnabled).toBeUndefined();
  expect(frames.size).toBe(0);
  disposeReduced();
  motionAllowed = true;
  timelineSupported = false;
  const disposeUnsupported = initialiseAboutMotion(page);
  expect(page.dataset.motionEnabled).toBeUndefined();
  expect(frames.size).toBe(0);
  disposeUnsupported();
});

test("motion responds to preference changes and removes listeners and pending work on unmount", async () => {
  const page = makePage();
  const dispose = initialiseAboutMotion(page);
  expect(page.dataset.motionEnabled).toBe("");
  expect(
    page
      .querySelectorAll("[data-stagger] > div")[1]
      ?.style.getPropertyValue("--item-index")
  ).toBe("1");
  expect(frames.size).toBe(1);
  motionAllowed = false;
  preferenceChange?.();
  expect(page.dataset.motionEnabled).toBeUndefined();
  motionAllowed = true;
  preferenceChange?.();
  expect(page.dataset.motionEnabled).toBe("");
  dispose();
  await Promise.resolve();
  frames.clear();
  dom.dispatchEvent(new dom.Event("scroll"));
  dom.dispatchEvent(new dom.Event("resize"));
  expect(frames.size).toBe(0);
  expect(preferenceChange).toBeUndefined();
  expect(page.dataset.motionEnabled).toBeUndefined();
});
