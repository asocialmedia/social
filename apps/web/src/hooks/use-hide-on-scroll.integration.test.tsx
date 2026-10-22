import { expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { useHideOnScroll } from "./use-hide-on-scroll";

test("feed toolbar visibility follows its own scroller through StrictMode remounting", async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    navigator: dom.navigator,
    window: dom,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const scrollRef = createRef<HTMLDivElement>();
  function Harness() {
    const hidden = useHideOnScroll(scrollRef, 2);
    return (
      <div ref={scrollRef}>
        <output data-hidden={hidden}>Filters</output>
      </div>
    );
  }
  try {
    await act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>
      )
    );
    const isHidden = () => host.querySelector("output")?.dataset.hidden;
    const scroll = async (top: number) => {
      await act(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = top;
          scrollRef.current.dispatchEvent(new Event("scroll"));
        }
      });
    };
    expect(isHidden()).toBe("false");
    await scroll(30);
    expect(isHidden()).toBe("true");
    await scroll(80);
    expect(isHidden()).toBe("true");
    await scroll(70);
    expect(isHidden()).toBe("false");
    await scroll(100);
    expect(isHidden()).toBe("true");
    await scroll(0);
    expect(isHidden()).toBe("false");
  } finally {
    await act(async () => {
      root.unmount();
      await dom.happyDOM.close();
    });
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  }
});
