import { beforeEach, expect, mock, test } from "bun:test";

let signedIn = true;
let permitted = true;
let changed = true;
const seenAt = "2026-10-18T11:42:00.000Z";
class ChatLifecycleError extends Error {
  readonly status = 404;
  constructor() {
    super("Unavailable");
    this.name = "ChatLifecycleError";
  }
}
const publish = mock(() => Promise.resolve());
const read = mock(() =>
  permitted
    ? Promise.resolve({ seenAt, unavailable: true })
    : Promise.reject(new ChatLifecycleError())
);
const acknowledge = mock(() =>
  permitted
    ? Promise.resolve({ changed, seenAt })
    : Promise.reject(new ChatLifecycleError())
);
mock.module("@asm/db", () => ({
  ChatLifecycleError,
  acknowledgeViewOnceSeen: acknowledge,
  consumeRateLimit: () => Promise.resolve({ allowed: true }),
  getViewOnceReceipt: read,
  publishMessageEvent: publish,
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "receiver" } } : null),
}));
mock.module("@/lib/messages/server", () => ({
  parseBoundedJsonBody: (request: Request) => request.json(),
}));
const { GET, POST } = await import("./route");
const id = crypto.randomUUID();
const mediaId = crypto.randomUUID();
const context = { params: Promise.resolve({ id, mediaId }) };
const url = `http://localhost/api/messages/conversations/${id}/media/${mediaId}/view-once/receipt`;

beforeEach(() => {
  signedIn = true;
  permitted = true;
  changed = true;
  publish.mockClear();
  acknowledge.mockClear();
  read.mockClear();
});

test("receipt reads require sign-in and reader access", async () => {
  signedIn = false;
  const anonymous = await GET(new Request(url), context);
  expect(anonymous.status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  signedIn = true;
  permitted = false;
  const denied = await GET(new Request(url), context);
  expect(denied.status).toBe(404);
});
test("receipt responses are private and never contain media URLs", async () => {
  const response = await GET(new Request(url), context);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ seenAt, unavailable: true });
});
test("a display acknowledgement broadcasts once and preserves the server time", async () => {
  const request = () =>
    new Request(url, {
      body: JSON.stringify({ grantId: crypto.randomUUID() }),
      method: "POST",
    });
  const response = await POST(request(), context);
  expect(await response.json()).toEqual({
    seenAt,
    unavailable: true,
  });
  expect(publish).toHaveBeenCalledWith({
    conversationId: id,
    kind: "media.viewOnce.seen",
    mediaId,
  });
  changed = false;
  await POST(request(), context);
  expect(publish).toHaveBeenCalledTimes(1);
});
test("invalid or malformed acknowledgements never reach the database", async () => {
  const malformed = await POST(
    new Request(url, { body: "{", method: "POST" }),
    context
  );
  expect(malformed.status).toBe(400);
  const invalid = await POST(
    new Request(url, {
      body: JSON.stringify({ grantId: "bad" }),
      method: "POST",
    }),
    context
  );
  expect(invalid.status).toBe(400);
  expect(acknowledge).not.toHaveBeenCalled();
});
