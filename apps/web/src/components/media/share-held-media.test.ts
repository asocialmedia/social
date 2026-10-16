import { afterEach, expect, spyOn, test } from "bun:test";

import { shareHeldMedia } from "./share-held-media";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator"
);
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (navigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
  if (windowDescriptor) {
    Object.defineProperty(globalThis, "window", windowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function environment(navigator: Partial<Navigator>) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigator,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://example.test" } },
  });
}
const media = { id: "held-image", type: "IMAGE" as const };

test("file-capable browsers share the asset file and do not fall back to a post link", async () => {
  let shared: ShareData | undefined;
  environment({
    canShare: () => true,
    share: (data) => {
      shared = data;
      return Promise.resolve();
    },
  });
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Blob(["image"], { type: "image/png" }))
  );
  try {
    expect(await shareHeldMedia(media, new AbortController().signal)).toBe(
      false
    );
    expect(shared?.files?.[0]?.name).toBe("asocialmedia-held-image.png");
    expect(shared?.files?.[0]?.type).toBe("image/png");
    expect(shared?.url).toBeUndefined();
  } finally {
    fetch.mockRestore();
  }
});

test("link-only sharing and clipboard fallback point at the held asset", async () => {
  let shared: ShareData | undefined;
  environment({
    share: (data) => {
      shared = data;
      return Promise.resolve();
    },
  });
  expect(await shareHeldMedia(media, new AbortController().signal)).toBe(false);
  expect(shared?.url).toBe(
    "https://example.test/api/media/download/held-image"
  );
  let copied = "";
  const clipboard = {
    writeText: (value: string) => {
      copied = value;
      return Promise.resolve();
    },
  };
  environment({ clipboard: clipboard as Clipboard });
  expect(await shareHeldMedia(media, new AbortController().signal)).toBe(true);
  expect(copied).toBe(shared?.url);
});

test("failed downloads do not share an error response as an image", async () => {
  let shared = false;
  environment({
    canShare: () => true,
    share: () => {
      shared = true;
      return Promise.resolve();
    },
  });
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("Unavailable", { status: 404 })
  );
  try {
    await expect(
      shareHeldMedia(media, new AbortController().signal)
    ).rejects.toThrow("Media download failed");
    expect(shared).toBe(false);
  } finally {
    fetch.mockRestore();
  }
});

test("canceling native sharing preserves AbortError for silent dismissal", async () => {
  environment({
    share: () => Promise.reject(new DOMException("Canceled", "AbortError")),
  });
  await expect(
    shareHeldMedia(media, new AbortController().signal)
  ).rejects.toMatchObject({ name: "AbortError" });
});
