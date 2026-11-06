import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

mock.module("./community-header", () => ({
  default: () => (
    <header data-measured-header="true">Community identity</header>
  ),
}));
mock.module("./community-section-nav", () => ({
  default: ({ identity }: { identity: ReactNode }) => <nav>{identity}</nav>,
}));
mock.module("./community-feed", () => ({
  default: () => <div>Member posts</div>,
}));
mock.module("@/components/layouts/feed/feed-scrollbar", () => ({
  FeedScrollbar: () => null,
}));

const originals = new Map<string, PropertyDescriptor | undefined>();
const resizeCallbacks = new Set<() => void>();
let dom: Window;
let root: Root | undefined;
let headerHeight = 248;

class HeaderResizeObserver implements ResizeObserver {
  private readonly notify: () => void;
  private readonly targets = new Set<Element>();
  constructor(onResize: ResizeObserverCallback) {
    this.notify = () => onResize([], this);
    resizeCallbacks.add(this.notify);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    resizeCallbacks.delete(this.notify);
  }
}

beforeAll(() => {
  dom = new Window({ url: "http://localhost/a/private" });
  dom.requestAnimationFrame = () => 1;
  Object.defineProperty(dom.document, "fonts", {
    value: { ready: Promise.resolve() },
  });
  Object.defineProperty(dom.HTMLElement.prototype, "offsetHeight", {
    get() {
      return this.firstElementChild?.dataset.measuredHeader === "true"
        ? headerHeight
        : 0;
    },
  });
  for (const [key, value] of Object.entries({
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: HeaderResizeObserver,
    SVGElement: dom.SVGElement,
    cancelAnimationFrame: () => {},
    document: dom.document,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    navigator: dom.navigator,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    window: dom,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  dom.document.body.innerHTML = "";
  resizeCallbacks.clear();
  headerHeight = 248;
});

afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  dom.happyDOM.abort();
});

async function render(canReadContent = false) {
  const { default: CommunityPostsWorkspace } =
    await import("./community-posts-workspace");
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <CommunityPostsWorkspace
        canReadContent={canReadContent}
        community={{
          accentColor: "slate",
          avatarUrl: null,
          bannerUrl: null,
          id: "private",
          name: "Private community",
          slug: "private",
          type: "PRIVATE",
        }}
        membership={null}
        members={1}
        subscribed={false}
      >
        <p>Membership request and public about</p>
      </CommunityPostsWorkspace>
    );
    await dom.document.fonts.ready;
  });
  const viewport = host.querySelector(
    'section[aria-label="Private community posts"]'
  );
  const spacer = viewport?.firstElementChild;
  if (!(viewport && spacer)) {
    throw new Error("Missing community viewport or header spacing");
  }
  return { spacer, viewport };
}

test("fresh private pages reserve the measured header before any animation frame or scroll", async () => {
  const { viewport, spacer } = await render();
  expect(viewport.scrollTop).toBe(0);
  expect(spacer.getAttribute("style")).toContain("height: 296px");
});

test("server markup keeps the unmeasured header in normal flow without duplicate clearance", async () => {
  const { default: CommunityPostsWorkspace } =
    await import("./community-posts-workspace");
  const host = dom.document.createElement("div");
  host.innerHTML = renderToString(
    <CommunityPostsWorkspace
      canReadContent={false}
      community={{
        accentColor: "slate",
        avatarUrl: null,
        bannerUrl: null,
        id: "private",
        name: "Private community",
        slug: "private",
        type: "PRIVATE",
      }}
      membership={null}
      members={1}
      subscribed={false}
    >
      <p>Membership request and public about</p>
    </CommunityPostsWorkspace>
  );
  const headerLayer = host.firstElementChild?.firstElementChild;
  expect(headerLayer?.classList.contains("relative")).toBe(true);
  expect(headerLayer?.classList.contains("absolute")).toBe(false);
  expect(
    host
      .querySelector("section[aria-label]")
      ?.firstElementChild?.getAttribute("style")
  ).toBe("height:0");
});

test("resizing or font reflow updates header clearance without user interaction", async () => {
  const { viewport, spacer } = await render();
  headerHeight = 204;
  await act(() => {
    for (const notify of resizeCallbacks) {
      notify();
    }
  });
  expect(viewport.scrollTop).toBe(0);
  expect(spacer.getAttribute("style")).toContain("height: 252px");
});

test("member pages also initialize their header clearance before animation frames", async () => {
  headerHeight = 312;
  const { spacer } = await render(true);
  expect(spacer.getAttribute("style")).toContain("height: 360px");
});

test("collapse and expansion keep layout clearance in sync while animation frames are paused", async () => {
  const { viewport, spacer } = await render();
  await act(() => {
    viewport.dispatchEvent(new dom.WheelEvent("wheel", { deltaY: 20 }));
  });
  expect(spacer.getAttribute("style")).toContain("height: 48px");
  headerHeight = 300;
  await act(() => {
    for (const notify of resizeCallbacks) {
      notify();
    }
  });
  expect(spacer.getAttribute("style")).toContain("height: 48px");
  await act(() => {
    viewport.dispatchEvent(new dom.WheelEvent("wheel", { deltaY: -20 }));
  });
  expect(spacer.getAttribute("style")).toContain("height: 348px");
});
