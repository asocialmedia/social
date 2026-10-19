import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
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
const openSpotlight = mock(() => {});
mock.module("@/components/search/spotlight-provider", () => ({
  useSpotlight: () => ({ openSpotlight }),
}));
const { createRoot } = await import("react-dom/client");
const { default: SearchField } = await import("./search-field");

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

test("the sidebar search opens the same main results dialog and closes its host panel", async () => {
  const element = dom.document.createElement("div");
  dom.document.body.append(element);
  const root = createRoot(element);
  const onAfterSearch = mock(() => {});
  await act(() => root.render(<SearchField onAfterSearch={onAfterSearch} />));
  const trigger = element.querySelector<HTMLButtonElement>(
    'button[aria-label="Search on asocialmedia"]'
  );
  expect(trigger).not.toBeNull();
  await act(() => trigger?.click());
  expect(openSpotlight).toHaveBeenCalledTimes(1);
  expect(onAfterSearch).toHaveBeenCalledTimes(1);
  expect(element.querySelector("form")).toBeNull();
  await act(() => root.unmount());
  element.remove();
});
