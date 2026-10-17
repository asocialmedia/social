import { afterEach, beforeEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import type { Element as HappyDomElement } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ChatModeTransition } from "./chat-mode-transition";

let dom: Window;
let root: Root;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  dom = new Window({ url: "http://localhost:3000" });
  for (const [key, value] of Object.entries({
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    window: dom,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
});

afterEach(async () => {
  await act(() => root.unmount());
  await dom.happyDOM.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  originalGlobals.clear();
});

async function show(sessionId: string | null) {
  await act(async () => {
    root.render(
      <ChatModeTransition
        sessionId={sessionId}
        incognito={<div>Incognito</div>}
      >
        <input aria-label="Normal draft" defaultValue="Unsent draft" />
      </ChatModeTransition>
    );
    await Promise.resolve();
  });
}

function finishAnimation(element: HappyDomElement, name: string) {
  const event = new dom.Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  element.dispatchEvent(event);
}

test("wipes into a new session while preserving the normal draft and its DOM", async () => {
  await show(null);
  const draft = dom.document.querySelector("input");
  await show("session-1");
  const normal = dom.document.querySelector(".chat-normal-transcript");
  const surface = dom.document.querySelector(".chat-incognito-reveal");
  expect(surface?.dataset.revealing).toBe("true");
  expect(normal?.hasAttribute("inert")).toBe(true);
  expect(normal?.getAttribute("aria-hidden")).toBe("true");
  expect(dom.document.querySelector("input")).toBe(draft);
  expect(draft?.value).toBe("Unsent draft");

  await show(null);
  expect(dom.document.querySelector(".chat-incognito-reveal")).toBeNull();
  expect(normal?.hasAttribute("inert")).toBe(false);
  expect(dom.document.querySelector("input")).toBe(draft);
});

test("returning to an existing session does not replay the entrance", async () => {
  await show("session-1");
  expect(
    dom.document.querySelector(".chat-incognito-reveal")?.dataset.revealing
  ).toBeUndefined();
});

test("only the completed surface animation retires the wipe layers", async () => {
  await show(null);
  await show("session-1");
  const surface = dom.document.querySelector(".chat-incognito-reveal");
  const content = dom.document.querySelector(".chat-incognito-reveal-content");
  if (!surface || !content) {
    throw new Error("Missing reveal surface");
  }
  await act(() => finishAnimation(content, "chat-incognito-counter-rise"));
  expect(surface.dataset.revealing).toBe("true");
  await act(() => finishAnimation(surface, "chat-incognito-rise"));
  expect(Object.hasOwn(surface.dataset, "revealing")).toBe(false);
  await show("session-1");
  expect(Object.hasOwn(surface.dataset, "revealing")).toBe(false);
  await show(null);
  await show("session-2");
  expect(
    dom.document.querySelector(".chat-incognito-reveal")?.dataset.revealing
  ).toBe("true");
});

test("reduced motion reveals immediately without replay when the preference changes", async () => {
  dom.happyDOM.settings.device.prefersReducedMotion = "reduce";
  await show(null);
  await show("session-1");
  const surface = dom.document.querySelector(".chat-incognito-reveal");
  expect(surface?.dataset.revealing).toBeUndefined();
  dom.happyDOM.settings.device.prefersReducedMotion = "no-preference";
  await show("session-1");
  expect(surface?.dataset.revealing).toBeUndefined();
});
