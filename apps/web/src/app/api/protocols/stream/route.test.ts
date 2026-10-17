import { beforeEach, expect, mock, test } from "bun:test";

let notify: ((_channel: string, raw: string) => void) | undefined;
let unsubscribeCount = 0;
const watches: unknown[] = [];
let deferred: Promise<undefined> | undefined;
class GatewayError extends Error {
  override name = "GatewayError";
}

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
mock.module("@/lib/protocols/recommendations", () => ({
  discoveryTopics: () => [],
}));
mock.module("@/lib/protocols/gateway", () => ({
  ProtocolGatewayError: GatewayError,
  protocolRoute: (
    _request: Request,
    _kind: string,
    run: () => Promise<Response>
  ) => run(),
}));
mock.module("@asm/db", () => ({
  getRecommendationProfile: () => Promise.resolve(null),
  redis: {
    publish: (_channel: string, raw: string) => {
      watches.push(JSON.parse(raw));
      return Promise.resolve(1);
    },
  },
  subscribeToChannel: async (_channel: string, listener: typeof notify) => {
    notify = listener;
    await deferred;
    return {
      unsubscribe: () => {
        unsubscribeCount += 1;
        return Promise.resolve();
      },
    };
  },
}));
const { GET } = await import("./route");
beforeEach(() => {
  watches.length = 0;
  unsubscribeCount = 0;
  deferred = undefined;
  notify = undefined;
});

test("guests receive bounded change hints, malformed and other-language hints are dropped, and abort unsubscribes", async () => {
  const controller = new AbortController();
  const response = await GET(
    new Request("http://localhost/api/protocols/stream?locale=en", {
      signal: controller.signal,
    })
  );
  if (!response.body) {
    throw new Error("Missing response body");
  }
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  const greeting = new TextDecoder().decode(firstChunk.value);
  expect(greeting).toContain('"source":"connected"');
  expect(watches).toEqual([{ locale: "en", renew: true, topics: [] }]);
  const next = reader.read();
  notify?.("feed", "invalid JSON");
  notify?.("feed", JSON.stringify({ locale: "es", source: "bluesky" }));
  for (let i = 0; i < 1000; i += 1) {
    notify?.("feed", JSON.stringify({ source: "asm" }));
  }
  const nextChunk = await next;
  const frame = new TextDecoder().decode(nextChunk.value);
  expect(frame).toBe('event: feed\ndata: {"source":"asm"}\n\n');
  controller.abort();
  await reader.cancel();
  expect(unsubscribeCount).toBe(1);
});

test("aborting while the subscriber connects still releases its eventual subscription", async () => {
  const pending = Promise.withResolvers<undefined>();
  deferred = pending.promise;
  const controller = new AbortController();
  const response = await GET(
    new Request("http://localhost/api/protocols/stream?locale=en", {
      signal: controller.signal,
    })
  );
  controller.abort();
  pending.resolve();
  await Bun.sleep(1);
  await response.body?.cancel();
  expect(unsubscribeCount).toBe(1);
  expect(watches).toEqual([]);
});
