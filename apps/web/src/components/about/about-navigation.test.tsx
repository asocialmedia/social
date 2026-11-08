import { afterEach, beforeEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AboutNavigation } from "./about-navigation";

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let root: Root;

beforeEach(() => {
  dom = new Window({ url: "https://asocialmedia.cc/about", width: 375 });
  for (const [name, value] of Object.entries({
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    navigator: dom.navigator,
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
  dom.document.body.innerHTML = '<div id="root"></div>';
  const container = dom.document.querySelector("#root");
  if (!container) {
    throw new Error("Missing navigation fixture");
  }
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
  originalGlobals.clear();
  await dom.happyDOM.abort();
});

test("the mobile menu opens as a modal, closes after section navigation and restores scrolling", async () => {
  dom.document.documentElement.style.overflow = "clip";
  await act(() => root.render(<AboutNavigation />));
  const toggle = dom.document.querySelector<HTMLButtonElement>(
    'button[aria-controls="about-menu"]'
  );
  const dialog = dom.document.querySelector<HTMLDialogElement>("dialog");
  if (!toggle || !dialog) {
    throw new Error("Missing navigation controls");
  }
  await act(() => toggle.click());
  expect(dialog.open).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(dom.document.documentElement.style.overflow).toBe("hidden");
  const sectionLink = dialog.querySelector<HTMLAnchorElement>(
    'a[href="#about-networks"]'
  );
  if (!sectionLink) {
    throw new Error("Missing network section link");
  }
  await act(() => sectionLink.click());
  expect(dialog.open).toBe(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(dom.document.documentElement.style.overflow).toBe("clip");
});

test("unmounting an open menu restores the previous document overflow", async () => {
  await act(() => root.render(<AboutNavigation />));
  const toggle = dom.document.querySelector<HTMLButtonElement>(
    'button[aria-controls="about-menu"]'
  );
  if (!toggle) {
    throw new Error("Missing menu button");
  }
  await act(() => toggle.click());
  expect(dom.document.documentElement.style.overflow).toBe("hidden");
  await act(() => root.render(null));
  expect(dom.document.documentElement.style.overflow).toBe("");
});
