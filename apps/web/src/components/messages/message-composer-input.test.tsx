import { afterEach, beforeEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { MessageComposerInput } from "./message-composer-input";

let dom: Window;
let root: Root;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  dom = new Window({ url: "http://localhost:3000" });
  for (const [key, value] of Object.entries({
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: dom.ResizeObserver,
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

const inputRef = createRef<HTMLTextAreaElement>();

async function show(value = "") {
  await act(() => {
    root.render(
      <MessageComposerInput
        inputRef={inputRef}
        placeholder="Message a_very_long_username_that_must_never_wrap…"
        value={value}
        onChange={() => {}}
      />
    );
  });
}

test("empty input exposes an accessible hint and one truncating visual placeholder", async () => {
  await show();
  const textarea = dom.document.querySelector("textarea");
  const hint = dom.document.querySelector("span");
  expect(textarea?.getAttribute("aria-placeholder")).toContain(
    "a_very_long_username"
  );
  expect(textarea?.hasAttribute("placeholder")).toBe(false);
  expect(hint?.classList.contains("truncate")).toBe(true);
  expect(hint?.getAttribute("aria-hidden")).toBe("true");
  expect(textarea?.style.height).toBe("40px");
  expect(textarea?.style.overflowY).toBe("hidden");
});

test("typing hides the hint, preserves multiline content, and clearing restores it", async () => {
  await show();
  await show("hello\nsecond line");
  expect(dom.document.querySelector("span")).toBeNull();
  expect(inputRef.current?.value).toBe("hello\nsecond line");
  await show();
  expect(dom.document.querySelector("span")?.textContent).toContain("Message");
  expect(inputRef.current?.style.height).toBe("40px");
});

test("long drafts scroll at the height limit and shrink when cleared", async () => {
  await show();
  const textarea = inputRef.current;
  if (!textarea) {
    throw new Error("Textarea did not mount");
  }
  Object.defineProperty(textarea, "scrollHeight", {
    configurable: true,
    get: () => (textarea.value ? 256 : 40),
  });
  await show("long draft");
  expect(textarea.style.height).toBe("136px");
  expect(textarea.style.overflowY).toBe("auto");
  await show();
  expect(textarea.style.height).toBe("40px");
  expect(textarea.style.overflowY).toBe("hidden");
});
