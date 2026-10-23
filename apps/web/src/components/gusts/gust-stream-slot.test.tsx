import { afterAll, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { GustStreamSlot, useGustStreamSlots } from "./gust-stream-slot";

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

function ClipStream({ ids, loading }: { ids: string[]; loading: boolean }) {
  const slots = useGustStreamSlots(ids, true, "test");
  return slots.map((slot, index) => (
    <GustStreamSlot
      index={slot.id === null ? undefined : index}
      key={slot.key}
      pending={slot.id === null}
      loading={loading}
    >
      {slot.id === null ? (
        "Loading"
      ) : (
        <div key={slot.id}>
          {slot.id}
          <video data-clip={slot.id}>
            <track kind="captions" />
          </video>
        </div>
      )}
    </GustStreamSlot>
  ));
}

test("the pending snap target becomes the next clip without replacing its DOM node", async () => {
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  const render = (ready: boolean, loading: boolean) =>
    root.render(
      <ClipStream
        ids={ready ? ["First clip", "Second clip"] : ["First clip"]}
        loading={loading}
      />
    );
  try {
    await act(() => render(false, true));
    const [, slot] = host.children;
    expect(slot.getAttribute("aria-busy")).toBe("true");
    await act(() => render(false, false));
    expect(host.children[1]).toBe(slot);
    expect(slot.getAttribute("aria-busy")).toBe("false");
    await act(() => render(true, false));
    expect(host.children[1]).toBe(slot);
    expect(slot.getAttribute("aria-label")).toBeNull();
    expect(slot.dataset.index).toBe("1");
    expect(slot.textContent).toBe("Second clip");
  } finally {
    await act(() => root.unmount());
  }
});

test("deep-stream prepends retain the viewed clip, playback element and pending target", async () => {
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(() =>
      root.render(<ClipStream ids={["a", "b", "c", "d"]} loading />)
    );
    const video = host.querySelector<HTMLVideoElement>('video[data-clip="c"]');
    expect(video).not.toBeNull();
    if (!video) {
      throw new Error("Missing viewed clip");
    }
    video.currentTime = 12;
    const slot = video.closest("[data-index]");
    const pending = host.querySelector('[aria-label="Loading more Gusts"]');
    await act(() =>
      root.render(
        <ClipStream ids={["new", "a", "b", "c", "d"]} loading={false} />
      )
    );
    expect(host.querySelector('video[data-clip="c"]')).toBe(video);
    expect(video.currentTime).toBe(12);
    expect(video.closest("[data-index]")).toBe(slot);
    expect(slot?.dataset.index).toBe("3");
    expect(host.querySelector('[aria-label="Loading more Gusts"]')).toBe(
      pending
    );
    await act(() =>
      root.render(
        <ClipStream ids={["new", "a", "b", "c", "d", "e"]} loading={false} />
      )
    );
    expect(
      host.querySelector('video[data-clip="e"]')?.closest("[data-index]")
    ).toBe(pending);
    expect(host.querySelector('video[data-clip="c"]')).toBe(video);
  } finally {
    await act(() => root.unmount());
  }
});
