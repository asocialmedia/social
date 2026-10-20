import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@asm/db", () => ({
  readNetworkPreferences: () => Promise.resolve(null),
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
class ProtocolGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number;
  constructor(status: number, code: string, retryAfter = 2) {
    super(code);
    this.name = "ProtocolGatewayError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
mock.module("./gateway", () => ({ ProtocolGatewayError }));
const { readBlueskyProfileResource } = await import("./service");
const originalFetch = globalThis.fetch;
const originalService = process.env.PROTOCOLS_SERVICE_URL;
const originalToken = process.env.PROTOCOLS_INTERNAL_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalService === undefined) {
    delete process.env.PROTOCOLS_SERVICE_URL;
  } else {
    process.env.PROTOCOLS_SERVICE_URL = originalService;
  }
  if (originalToken === undefined) {
    delete process.env.PROTOCOLS_INTERNAL_TOKEN;
  } else {
    process.env.PROTOCOLS_INTERNAL_TOKEN = originalToken;
  }
});

test.each(["profile", "author-feed"] as const)(
  "%s preserves the source cooldown so automatic recovery waits until it can succeed",
  async (kind) => {
    process.env.PROTOCOLS_SERVICE_URL = "http://protocols.test";
    process.env.PROTOCOLS_INTERNAL_TOKEN = "test-fixture";
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: mock(() =>
        Promise.resolve(
          new Response(null, { headers: { "retry-after": "4" }, status: 503 })
        )
      ),
      writable: true,
    });
    await expect(
      readBlueskyProfileResource(
        kind,
        new URLSearchParams({ actor: "bsky.app" }),
        AbortSignal.timeout(1000),
        "test",
        false
      )
    ).rejects.toMatchObject({ retryAfter: 4, status: 503 });
  }
);
