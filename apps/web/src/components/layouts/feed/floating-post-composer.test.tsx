import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const editor = mock(({ variant }: { variant: string }) => (
  <textarea aria-label={`${variant} editor`} />
));
mock.module("next/dynamic", () => ({ default: () => editor }));
const { default: FloatingPostComposer } =
  await import("./floating-post-composer");
const { useComposerStore } = await import("@/store/composer-store");
const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
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

test("the deferred composer opens on demand and still closes with Escape or the backdrop", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(() => root.render(<FloatingPostComposer />));
  expect(editor).not.toHaveBeenCalled();
  await act(() => useComposerStore.getState().openComposer());
  expect(host.querySelector("textarea")?.getAttribute("aria-label")).toBe(
    "modal editor"
  );
  await act(() =>
    dom.document.dispatchEvent(
      new dom.KeyboardEvent("keydown", { key: "Escape" })
    )
  );
  expect(host.querySelector("textarea")).toBeNull();
  expect(useComposerStore.getState().isOpen).toBe(false);
  await act(() => useComposerStore.getState().openComposer());
  await act(() =>
    host.querySelector<HTMLElement>('[aria-hidden="true"]')?.click()
  );
  expect(useComposerStore.getState().isOpen).toBe(false);
  await act(() => root.unmount());
  host.remove();
});
