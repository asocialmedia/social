import { beforeEach, expect, mock, test } from "bun:test";

let active = true;
let storageFailure = false;
let releaseFailure = false;
let allowed = true;
const release = mock(() =>
  releaseFailure ? Promise.reject(new Error("offline")) : Promise.resolve()
);
const reserve = mock(() =>
  Promise.resolve({
    mimeType: "image/png",
    objectKey: "protected/photo",
    size: 999,
  })
);
class ChatLifecycleError extends Error {
  readonly code = "VIEW_ONCE_UNAVAILABLE";
  readonly status = 410;
  constructor() {
    super("VIEW_ONCE_UNAVAILABLE");
    this.name = "ChatLifecycleError";
  }
}
mock.module("@asm/db", () => ({
  ChatLifecycleError,
  activateViewOnceGrant: () => Promise.resolve(active),
  consumeRateLimit: () => Promise.resolve({ allowed }),
  releaseViewOnceGrant: release,
  reserveViewOnceMedia: reserve,
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve({ user: { id: "viewer" } }),
}));
mock.module("@/lib/media/object-storage", () => ({
  ASMOB_BUCKET: "bucket",
  asmobClient: {
    send: () =>
      storageFailure
        ? Promise.reject(new Error("storage unavailable"))
        : Promise.resolve({
            Body: {
              transformToWebStream: () =>
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3, 4]));
                    controller.close();
                  },
                }),
            },
            ContentLength: 4,
          }),
  },
}));
const { GET } = await import("./route");
function open() {
  return GET(
    new Request("https://example.test/open", {
      headers: { "X-View-Once-Grant": crypto.randomUUID() },
    }),
    { params: Promise.resolve({ id: "chat", mediaId: "photo" }) }
  );
}
beforeEach(() => {
  active = true;
  storageFailure = false;
  releaseFailure = false;
  allowed = true;
  release.mockClear();
  reserve.mockClear();
});
test("serves the stored object length instead of the original upload length", async () => {
  const response = await open();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Length")).toBe("4");
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const bytes = await response.arrayBuffer();
  expect(bytes.byteLength).toBe(4);
});
test("an access change before activation returns no photo bytes", async () => {
  active = false;
  const response = await open();
  expect(response.status).toBe(410);
  expect(release).toHaveBeenCalledTimes(1);
});
test("storage and release failures return a safe retryable response", async () => {
  storageFailure = true;
  releaseFailure = true;
  const response = await open();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("storage unavailable");
});
test("the request budget is checked before reserving a grant", async () => {
  allowed = false;
  const response = await open();
  expect(response.status).toBe(429);
  expect(reserve).not.toHaveBeenCalled();
});
