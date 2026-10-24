import { afterAll, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  SVGElement: dom.SVGElement,
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  document: dom.document,
  getComputedStyle: dom.getComputedStyle.bind(dom),
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
const { Tabs, TabsList } = await import("@asm/ui/shadui/tabs");
const { AnimatedTabTrigger } = await import("./animated-tab-trigger");
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

function Controls({ reselect }: { reselect: (name: string) => void }) {
  const [active, setActive] = useState("latest");
  return (
    <Tabs value={active} onValueChange={setActive}>
      <TabsList>
        {["latest", "following"].map((name) => (
          <AnimatedTabTrigger
            key={name}
            active={active === name}
            layoutId="test-tabs"
            value={name}
            onReselect={() => reselect(name)}
          >
            {name}
          </AnimatedTabTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

test("reselecting a tab by pointer or keyboard jumps to top without resetting a newly selected tab", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const selected: string[] = [];
  try {
    await act(() =>
      root.render(<Controls reselect={(name) => selected.push(name)} />)
    );
    const latest =
      host.querySelector('[value="latest"]') ??
      host.querySelectorAll('[role="tab"]')[0];
    const following =
      host.querySelector('[value="following"]') ??
      host.querySelectorAll('[role="tab"]')[1];
    if (!latest || !following) {
      throw new Error("Tabs not rendered");
    }
    await act(() =>
      latest.dispatchEvent(
        new dom.PointerEvent("pointerdown", { bubbles: true, button: 0 })
      )
    );
    await act(() =>
      latest.dispatchEvent(
        new dom.MouseEvent("mousedown", { bubbles: true, button: 0 })
      )
    );
    await act(() =>
      latest.dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, button: 0 })
      )
    );
    expect(selected).toEqual(["latest"]);

    await act(() =>
      following.dispatchEvent(
        new dom.PointerEvent("pointerdown", { bubbles: true, button: 0 })
      )
    );
    await act(() =>
      following.dispatchEvent(
        new dom.MouseEvent("mousedown", { bubbles: true, button: 0 })
      )
    );
    expect(following.getAttribute("aria-selected")).toBe("true");
    await act(() =>
      following.dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, button: 0 })
      )
    );
    expect(selected).toEqual(["latest"]);

    await act(() =>
      following.dispatchEvent(
        new dom.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      )
    );
    await act(() =>
      following.dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, detail: 0 })
      )
    );
    expect(selected).toEqual(["latest", "following"]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
