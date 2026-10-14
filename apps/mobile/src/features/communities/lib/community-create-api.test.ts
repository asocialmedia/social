import { expect, test } from "bun:test";

import { createCommunity } from "./community-create-api";
import { emptyCommunityDraft } from "./community-create-contract";

function stubFetch(
  handler: (input: string, init?: RequestInit) => Response
): typeof fetch {
  return Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      Promise.resolve(handler(String(input), init)),
    { preconnect: fetch.preconnect }
  );
}
const draft = {
  ...emptyCommunityDraft(),
  description: "A new space",
  name: "Hackers",
  slug: "hackers",
};
test("create sends one authenticated request with only the community fields", async () => {
  let calls = 0;
  const result = await createCommunity(draft, {
    apiBase: "https://asm.test",
    baseFetch: stubFetch((input, init) => {
      calls += 1;
      expect(input).toBe("https://asm.test/api/communities");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer token",
        cookie: "better-auth.session_token=token",
      });
      expect(JSON.parse(String(init?.body))).toEqual(draft);
      return Response.json({ slug: "hackers" });
    }),
    cookie: "better-auth.session_token=token",
  });
  expect(result).toEqual({ kind: "success", slug: "hackers" });
  expect(calls).toBe(1);
});
test("install verification can retry the same draft without treating it as failure", async () => {
  expect(
    await createCommunity(draft, {
      apiBase: "https://asm.test",
      baseFetch: stubFetch(() =>
        Response.json({ error: "install-token-required" }, { status: 403 })
      ),
    })
  ).toEqual({ kind: "install-token-required" });
});
test("outages and unexpected responses keep diagnostics away from the reader", async () => {
  const results = await Promise.all(
    [
      Response.json(
        { error: "Database SQL connection failed" },
        { status: 500 }
      ),
      new Response("Internal error", { status: 502 }),
      Response.json({}),
    ].map((response) =>
      createCommunity(draft, {
        apiBase: "https://asm.test",
        baseFetch: stubFetch(() => response),
      })
    )
  );
  for (const result of results) {
    expect(result).toEqual({
      kind: "error",
      message: "We couldn’t create that community. Please try again.",
    });
  }
  expect(
    await createCommunity(draft, {
      apiBase: "https://asm.test",
      baseFetch: stubFetch(() => {
        throw new Error("DNS exception");
      }),
    })
  ).toEqual({
    kind: "error",
    message: "Check your connection, then try again. Your draft is saved.",
  });
});
test("actionable server validation remains visible", async () => {
  expect(
    await createCommunity(draft, {
      apiBase: "https://asm.test",
      baseFetch: stubFetch(() =>
        Response.json(
          { error: "That address is already in use" },
          { status: 409 }
        )
      ),
    })
  ).toEqual({ kind: "error", message: "That address is already in use" });
});
