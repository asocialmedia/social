import { afterEach, expect, mock, test } from "bun:test";

const registry = mock(() => Promise.resolve([]));
const reconcile = mock(() => Promise.resolve());
const publish = mock(() => Promise.resolve(0));
mock.module("@asm/db", () => ({
  externalFollowRegistry: registry,
  reconcileExternalAuthor: reconcile,
  redis: { publish },
}));
const { GET, POST } = await import("./route");
const originalToken = process.env.PROTOCOLS_INTERNAL_TOKEN;
const token = "test_internal_protocol_token_32_characters";
afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.PROTOCOLS_INTERNAL_TOKEN;
  } else {
    process.env.PROTOCOLS_INTERNAL_TOKEN = originalToken;
  }
  registry.mockClear();
  reconcile.mockClear();
  publish.mockClear();
});

test("missing and invalid service credentials are rejected before registry reads or reconciliation", async () => {
  process.env.PROTOCOLS_INTERNAL_TOKEN = token;
  for (const authorization of [
    undefined,
    "Bearer bad",
    `Bearer ${"x".repeat(token.length)}`,
  ]) {
    const headers = new Headers({ "content-type": "application/json" });
    if (authorization) {
      headers.set("authorization", authorization);
    }
    const request = () =>
      new Request("https://asocialmedia.cc/api/internal/protocols/follows", {
        headers,
      });
    // oxlint-disable-next-line no-await-in-loop -- validate both handlers for each credential fixture.
    const [get, post] = await Promise.all([
      GET(request()),
      POST(new Request(request(), { body: "not even JSON", method: "POST" })),
    ]);
    expect(get.status).toBe(401);
    expect(post.status).toBe(401);
  }
  expect(registry).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

test("a valid service bearer token can reconcile reports without a browser install token", async () => {
  process.env.PROTOCOLS_INTERNAL_TOKEN = token;
  const report = { did: "did:plc:alice", status: "active" };
  const response = await POST(
    new Request("https://asocialmedia.cc/api/internal/protocols/follows", {
      body: JSON.stringify([report]),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    })
  );
  expect(response.status).toBe(200);
  expect(reconcile).toHaveBeenCalledWith(report);
  expect(publish).toHaveBeenCalledTimes(1);
});
