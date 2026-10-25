import { afterAll, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { revealFeedHead } from "./feed-cache";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) {Object.defineProperty(globalThis, key, descriptor);}
    else {Reflect.deleteProperty(globalThis, key);}
  }
});

function Feed() {
  const [items, setItems] = useState(["old"]);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={() =>
          revealFeedHead(ref.current, () => setItems(["new", "old"]))
        }
      >
        Reveal new posts
      </button>
      {items.map((item) => (
        <article key={item} data-feed-item>
          {item}
        </article>
      ))}
    </div>
  );
}

test("new feed cards are committed before the pill starts scrolling the overflow container", async () => {
  const scroll = dom.document.createElement("div");
  scroll.style.overflowY = "auto";
  scroll.scrollTop = 1200;
  Object.defineProperty(scroll, "clientHeight", { value: 600 });
  Object.defineProperty(scroll, "scrollHeight", { value: 3000 });
  dom.document.body.append(scroll);
  const host = dom.document.createElement("div");
  scroll.append(host);
  let firstAtScroll: string | null = null;
  Object.defineProperty(scroll, "scrollTo", {
    value: () => {
      firstAtScroll = scroll.querySelector("article")?.textContent ?? null;
      scroll.scrollTop = 0;
    },
  });
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(() => root.render(<Feed />));
    await act(() => {
      scroll.querySelector("button")?.click();
    });
    expect(firstAtScroll).toBe("new");
    expect(scroll.scrollTop).toBe(0);
  } finally {
    await act(() => root.unmount());
    scroll.remove();
  }
});
