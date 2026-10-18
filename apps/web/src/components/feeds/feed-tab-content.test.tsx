import { afterAll, expect, mock, test } from "bun:test";

import { Tabs } from "@asm/ui/shadui/tabs";
import { Window } from "happy-dom";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { useFeedTabSelection } from "@/hooks/feed/use-feed-tab-selection";

import { FeedTabContent } from "./feed-tab-content";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
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

function Selection({ resolved }: { resolved: "first" | "second" }) {
  const [selected, select] = useFeedTabSelection(resolved);
  return (
    <>
      <button data-switch="first" onClick={() => select("first")} type="button">
        First
      </button>
      <button
        data-switch="second"
        onClick={() => select("second")}
        type="button"
      >
        Second
      </button>
      <output>{selected}</output>
    </>
  );
}

test("selection follows the latest click immediately while URL state is pending, and adopts history changes", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(() => root.render(<Selection resolved="first" />));
  await act(() =>
    host
      .querySelector('[data-switch="second"]')
      ?.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }))
  );
  expect(host.querySelector("output")?.textContent).toBe("second");
  await act(() =>
    host
      .querySelector('[data-switch="first"]')
      ?.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }))
  );
  expect(host.querySelector("output")?.textContent).toBe("first");
  await act(() => root.render(<Selection resolved="second" />));
  expect(host.querySelector("output")?.textContent).toBe("second");
  await act(() => root.render(<Selection resolved="first" />));
  expect(host.querySelector("output")?.textContent).toBe("first");
  await act(() => root.unmount());
  host.remove();
});

function Card({
  name,
  onStart,
  onStop,
}: {
  name: string;
  onStart: () => void;
  onStop: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    onStart();
    return onStop;
  }, [onStart, onStop]);
  return (
    <button
      data-card={name}
      onClick={() => setExpanded((value) => !value)}
      type="button"
    >
      {expanded ? "Expanded" : "Collapsed"}
    </button>
  );
}

test("visited tabs retain their own card state and DOM while hidden work stops", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const firstStart = mock();
  const firstStop = mock();
  const secondStart = mock();
  const secondStop = mock();
  const render = (active: string) =>
    act(() =>
      root.render(
        <Tabs value={active}>
          <FeedTabContent activeTab={active} value="first">
            <Card name="first" onStart={firstStart} onStop={firstStop} />
          </FeedTabContent>
          <FeedTabContent activeTab={active} value="second">
            <Card name="second" onStart={secondStart} onStop={secondStop} />
          </FeedTabContent>
        </Tabs>
      )
    );
  await render("first");
  const first = host.querySelector('[data-card="first"]');
  expect(firstStart).toHaveBeenCalledTimes(1);
  expect(secondStart).toHaveBeenCalledTimes(0);
  expect(host.querySelector('[data-card="second"]')).toBeNull();
  await act(() =>
    first?.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }))
  );
  expect(first?.textContent).toBe("Expanded");
  await render("second");
  expect(firstStop).toHaveBeenCalledTimes(1);
  expect(secondStart).toHaveBeenCalledTimes(1);
  expect(first?.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(
    true
  );
  const second = host.querySelector('[data-card="second"]');
  expect(second?.textContent).toBe("Collapsed");
  await act(() =>
    second?.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }))
  );
  await render("first");
  expect(host.querySelector('[data-card="first"]')).toBe(first);
  expect(first?.textContent).toBe("Expanded");
  expect(secondStop).toHaveBeenCalledTimes(1);
  expect(firstStart).toHaveBeenCalledTimes(2);
  await render("second");
  expect(host.querySelector('[data-card="second"]')).toBe(second);
  expect(second?.textContent).toBe("Expanded");
  await act(() => root.unmount());
  host.remove();
});
