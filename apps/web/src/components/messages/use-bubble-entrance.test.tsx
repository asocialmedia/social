import { afterEach, beforeEach, expect, test } from "bun:test";

import { BubbleEntranceRegistry } from "@asm/messages";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { useBubbleEntrance } from "./use-bubble-entrance";

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

function Bubble({
  entrances,
  id,
}: {
  entrances: BubbleEntranceRegistry;
  id: string;
}) {
  const [entering, finish, motionRef] = useBubbleEntrance(entrances, id);
  return (
    <div data-entering={entering} onAnimationEnd={finish} ref={motionRef}>
      {id}
    </div>
  );
}

async function show(
  entrances: BubbleEntranceRegistry,
  id: string,
  ready = true
) {
  await act(() => {
    root.render(
      <StrictMode>
        {ready ? (
          <Bubble key={id} entrances={entrances} id={id} />
        ) : (
          <div>Decrypting</div>
        )}
      </StrictMode>
    );
  });
}

test("Strict Mode and receipt rerenders keep one entrance; recycling does not replay it", async () => {
  const entrances = new BubbleEntranceRegistry();
  entrances.register("sent");
  await show(entrances, "sent");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "true"
  );
  expect(entrances.isPending("sent")).toBe(false);
  await show(entrances, "sent");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "true"
  );
  await show(entrances, "sent", false);
  entrances.register("sent");
  await show(entrances, "sent");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "false"
  );
});

test("history stays still and a new arrival waits for its decrypted bubble", async () => {
  const entrances = new BubbleEntranceRegistry();
  await show(entrances, "history");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "false"
  );
  entrances.register("incoming");
  await show(entrances, "incoming", false);
  expect(entrances.isPending("incoming")).toBe(true);
  await show(entrances, "incoming");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "true"
  );
  expect(entrances.isPending("incoming")).toBe(false);
});

test("finished entrances release the class and do not restart on updates", async () => {
  const entrances = new BubbleEntranceRegistry();
  entrances.register("sent");
  await show(entrances, "sent");
  await act(() => {
    dom.document
      .querySelector("[data-entering]")
      ?.dispatchEvent(new dom.Event("animationend", { bubbles: true }));
  });
  await show(entrances, "sent");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "false"
  );
});

test("the launch snapshot survives Strict Mode and releases its compositor hints after settling", async () => {
  const entrances = new BubbleEntranceRegistry();
  entrances.register("launched", Date.now(), { x: 20, y: 50 });
  await show(entrances, "launched");
  const element = dom.document.querySelector<HTMLElement>("[data-entering]");
  expect(element?.style.getPropertyValue("--msg-launch-x")).toBe("20px");
  expect(element?.style.getPropertyValue("--msg-launch-y")).toBe("50px");
  expect(element?.style.getPropertyValue("--msg-flight-easing")).toStartWith(
    "linear("
  );
  await act(() =>
    element?.dispatchEvent(new dom.Event("animationend", { bubbles: true }))
  );
  expect(element?.style.getPropertyValue("--msg-flight-easing")).toBe("");
  expect(element?.style.getPropertyValue("--msg-launch-y")).toBe("");
});

test("older browsers get a valid easing fallback and interrupted entrances release their layer hints", async () => {
  Object.defineProperty(dom, "CSS", {
    configurable: true,
    value: { supports: () => false },
  });
  const entrances = new BubbleEntranceRegistry();
  entrances.register("fallback");
  await show(entrances, "fallback");
  const element = dom.document.querySelector<HTMLElement>("[data-entering]");
  expect(element?.style.getPropertyValue("--msg-flight-easing")).toBe(
    "cubic-bezier(0.16, 1, 0.3, 1)"
  );
  await act(() => Bun.sleep(690));
  expect(element?.dataset.entering).toBe("false");
  expect(element?.style.getPropertyValue("--msg-flight-easing")).toBe("");
});

test("reduced motion consumes the arrival without applying an animation", async () => {
  Object.defineProperty(dom, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true }),
  });
  const entrances = new BubbleEntranceRegistry();
  entrances.register("incoming");
  await show(entrances, "incoming");
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "false"
  );
  expect(entrances.isPending("incoming")).toBe(false);
});

test("enabling reduced motion mid-entrance stops it without replay when disabled", async () => {
  const preference = new dom.EventTarget();
  Object.defineProperty(preference, "matches", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(dom, "matchMedia", {
    configurable: true,
    value: () => preference,
  });
  const entrances = new BubbleEntranceRegistry();
  entrances.register("incoming");
  await show(entrances, "incoming");
  await act(() => {
    Object.defineProperty(preference, "matches", {
      configurable: true,
      value: true,
    });
    preference.dispatchEvent(new dom.Event("change"));
  });
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "false"
  );
  await act(() => {
    Object.defineProperty(preference, "matches", {
      configurable: true,
      value: false,
    });
    preference.dispatchEvent(new dom.Event("change"));
  });
  expect(dom.document.querySelector("[data-entering]")?.dataset.entering).toBe(
    "false"
  );
});
