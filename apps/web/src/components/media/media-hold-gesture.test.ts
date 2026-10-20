import { expect, test } from "bun:test";

import { Window } from "happy-dom";

import { createMediaHoldGesture, findHeldMedia } from "./media-hold-gesture";
import { mediaHoldPreviewLayout } from "./media-hold-layout";

function noop() {
  return null;
}

function fixture() {
  let fire: () => void = noop;
  let time = 0;
  let opened = 0;
  const gesture = createMediaHoldGesture(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- deterministic scheduler fires only when this test advances the gesture.
    (callback) => {
      fire = callback;
      return () => {
        fire = noop;
      };
    },
    () => time
  );
  return {
    advance: (value: number) => {
      time += value;
    },
    count: () => opened,
    gesture,
    open: () => {
      opened += 1;
    },
    tick: () => fire(),
  };
}

test("a tap and a scrolling gesture do not open the menu or swallow navigation", () => {
  const f = fixture();
  f.gesture.start(1, 10, 10, f.open);
  f.gesture.release(1);
  f.tick();
  expect(f.count()).toBe(0);
  expect(f.gesture.suppressClick()).toBe(false);
  f.gesture.start(2, 10, 10, f.open);
  f.gesture.move(2, 10, 21);
  f.tick();
  expect(f.count()).toBe(0);
});

test("release stays suppressed after a long hold, even beyond the old one-second timeout", () => {
  const f = fixture();
  f.gesture.start(1, 10, 10, f.open);
  f.tick();
  f.advance(5000);
  expect(f.count()).toBe(1);
  expect(f.gesture.suppressClick()).toBe(true);
  f.gesture.release(1);
  expect(f.gesture.suppressClick()).toBe(true);
  f.advance(751);
  expect(f.gesture.suppressClick()).toBe(false);
});

test("a fresh tap works immediately after dismissal and canceled holds never fire", () => {
  const f = fixture();
  f.gesture.start(1, 0, 0, f.open);
  f.tick();
  f.gesture.release(1);
  f.gesture.start(2, 0, 0, f.open);
  f.gesture.release(2);
  expect(f.gesture.suppressClick()).toBe(false);
  f.gesture.start(3, 0, 0, f.open);
  f.gesture.cancel();
  f.tick();
  expect(f.count()).toBe(1);
});

test("unrelated pointer releases do not cancel the held finger", () => {
  const f = fixture();
  f.gesture.start(4, 0, 0, f.open);
  f.gesture.release(9);
  f.tick();
  f.gesture.release(9);
  expect(f.count()).toBe(1);
  expect(f.gesture.suppressClick()).toBe(true);
});

test("an interrupted pointer cannot leave future holds stuck after app switching", () => {
  const f = fixture();
  f.gesture.start(1, 0, 0, f.open);
  f.tick();
  f.gesture.interrupt();
  f.gesture.start(2, 0, 0, f.open);
  f.tick();
  expect(f.count()).toBe(2);
});

test("grid holds select the touched image or video, including source-backed video", () => {
  const window = new Window();
  window.document.body.innerHTML =
    '<button><img src="/api/media/first"></button><button><video poster="/api/media/second"><source src="/api/media/second?video=1"></video></button><div role="dialog"><img src="/api/media/first"></div>';
  const media = [{ id: "first" }, { id: "second" }];
  const [image, video, dialogImage] =
    window.document.querySelectorAll("img,video");
  expect(findHeldMedia(image as unknown as Element, media)?.index).toBe(0);
  expect(findHeldMedia(video as unknown as Element, media)?.index).toBe(1);
  expect(findHeldMedia(dialogImage as unknown as Element, media)).toBeNull();
  expect(
    findHeldMedia(window.document.body as unknown as Element, media)
  ).toBeNull();

  // External images whose img src matches thumbnailKey instead of full media.id
  const externalMedia = [
    {
      id: "https://cdn.bsky.app/original",
      thumbnailKey: "https://cdn.bsky.app/thumb",
    },
  ];
  window.document.body.innerHTML =
    '<button><img src="https://cdn.bsky.app/thumb"></button>';
  const externalImg = window.document.querySelector("img");
  expect(
    findHeldMedia(externalImg as unknown as Element, externalMedia)?.index
  ).toBe(0);

  void window.happyDOM.close();
});

test("floating media preserves its aspect and stays above the sheet across mobile viewports", () => {
  const bounds = { height: 380, width: 210, x: 16, y: 220 };
  for (const viewport of [
    { height: 568, top: 0, width: 320 },
    { height: 844, top: 0, width: 390 },
    { height: 360, top: 20, width: 700 },
  ]) {
    for (const media of [
      { height: 1920, width: 1080 },
      { height: 1080, width: 1920 },
      { height: null, width: null },
    ]) {
      const sheet = Math.min(viewport.height * 0.48, 392);
      const rect = mediaHoldPreviewLayout(viewport, media, bounds, sheet);
      expect(rect.x).toBeGreaterThanOrEqual(8);
      expect(rect.y).toBeGreaterThanOrEqual(viewport.top + 8);
      expect(rect.y + rect.height).toBeLessThanOrEqual(
        viewport.top + viewport.height - sheet - 12.00001 + 0.001
      );
      expect(rect.width / rect.height).toBeCloseTo(
        media.width && media.height
          ? media.width / media.height
          : bounds.width / bounds.height
      );
    }
  }
});
