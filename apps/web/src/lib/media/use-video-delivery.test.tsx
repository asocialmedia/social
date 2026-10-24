import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";

const instances: FakeHls[] = [];
class FakeHls {
  static Events = { ERROR: "error", MANIFEST_PARSED: "manifest" };
  static isSupported = () => true;
  listeners = new Map<
    string,
    (event?: string, data?: { fatal: boolean }) => void
  >();
  destroy = mock(() => {});
  constructor() {
    instances.push(this);
  }
  on(
    event: string,
    listener: (event: string, data: { fatal: boolean }) => void
  ) {
    this.listeners.set(event, (name, data) =>
      listener(name ?? event, data ?? { fatal: false })
    );
  }
  attachMedia = mock(() => {});
  loadSource = mock(() => {});
}
mock.module("hls.js", () => ({ default: FakeHls }));
const { useVideoDelivery } = await import("./use-video-delivery");
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

test("external Gust HLS uses the source playlist and never falls back to ASM media", async () => {
  const play = mock(() => Promise.resolve());
  const intent = { current: true };
  const playlist = "https://video.bsky.app/watch/clip/playlist.m3u8";
  function Gust() {
    const ref = useRef<HTMLVideoElement>(null);
    useVideoDelivery(ref, "remote-media", true, true, intent, playlist);
    return (
      <video ref={ref}>
        <track kind="captions" />
      </video>
    );
  }
  Object.defineProperty(dom.HTMLVideoElement.prototype, "play", {
    configurable: true,
    value: play,
  });
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  await act(() => root.render(<Gust />));
  const hls = instances.at(-1);
  expect(hls?.loadSource).toHaveBeenCalledWith(playlist);
  await act(() => hls?.listeners.get("manifest")?.());
  expect(play).toHaveBeenCalledTimes(1);
  const video = host.querySelector("video");
  expect(video?.getAttribute("src")).toBeNull();
  await act(() => hls?.listeners.get("error")?.("error", { fatal: true }));
  expect(video?.getAttribute("src")).toBeNull();
  expect(hls?.destroy).toHaveBeenCalledTimes(1);
  await act(() => root.unmount());
});

test("late HLS manifests resume an intended hover preview but never restart after mouse leave", async () => {
  const play = mock(() => Promise.resolve());
  Object.defineProperty(dom.HTMLVideoElement.prototype, "play", {
    configurable: true,
    value: play,
  });
  const intent = { current: true };
  function Preview({ enabled }: { enabled: boolean }) {
    const ref = useRef<HTMLVideoElement>(null);
    useVideoDelivery(
      ref,
      "https://video.bsky.app/watch/test/playlist.m3u8",
      enabled,
      true,
      intent
    );
    return (
      <video ref={ref}>
        <track kind="captions" />
      </video>
    );
  }
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  await act(() => {
    root.render(<Preview enabled />);
  });
  const hls = instances.at(-1);
  expect(hls).toBeDefined();
  await act(() => {
    hls?.listeners.get("manifest")?.();
  });
  expect(play).toHaveBeenCalledTimes(1);
  intent.current = false;
  await act(() => {
    hls?.listeners.get("manifest")?.();
  });
  expect(play).toHaveBeenCalledTimes(1);
  await act(() => {
    root.render(<Preview enabled={false} />);
  });
  expect(hls?.destroy).toHaveBeenCalledTimes(1);
  intent.current = true;
  await act(() => {
    hls?.listeners.get("manifest")?.();
  });
  expect(play).toHaveBeenCalledTimes(1);
  await act(() => root.unmount());
});
