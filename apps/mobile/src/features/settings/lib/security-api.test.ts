import { describe, expect, test } from "bun:test";

import { fetchPasskeys, removePasskey } from "./security-api";

function optionsFor(response: Response) {
  const requests: { url: string; headers: Headers }[] = [];
  const baseFetch: typeof fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        headers: new Headers(init?.headers),
        url: String(input),
      });
      return Promise.resolve(response);
    },
    { preconnect: fetch.preconnect }
  );
  return {
    options: {
      apiBase: "https://example.test",
      baseFetch,
      cookie: "__Secure-better-auth.session_token=signed-session",
    },
    requests,
  };
}

describe("native passkey requests", () => {
  test("a server failure is distinct from an empty passkey list", async () => {
    const failure = optionsFor(
      new Response("Internal Server Error", { status: 500 })
    );
    expect(await fetchPasskeys(failure.options)).toBeNull();
    const empty = optionsFor(Response.json([]));
    expect(await fetchPasskeys(empty.options)).toEqual([]);
  });

  test("loads passkey metadata with both native session transports", async () => {
    const { options, requests } = optionsFor(
      Response.json([
        {
          aaguid: null,
          backedUp: true,
          createdAt: "2026-10-10T00:00:00Z",
          deviceType: "multiDevice",
          id: "key-1",
          name: "Pixel",
        },
      ])
    );
    expect(await fetchPasskeys(options)).toEqual([
      {
        aaguid: null,
        backedUp: true,
        createdAt: "2026-10-10T00:00:00Z",
        deviceType: "multiDevice",
        id: "key-1",
        name: "Pixel",
      },
    ]);
    expect(requests[0].url).toBe(
      "https://example.test/api/auth/passkey/list-user-passkeys"
    );
    expect(requests[0].headers.get("cookie")).toBe(options.cookie);
    expect(requests[0].headers.get("authorization")).toBe(
      "Bearer signed-session"
    );
  });

  test("a fresh-session requirement preserves the reauthentication flow", async () => {
    const { options } = optionsFor(
      Response.json({ message: "Session is not fresh" }, { status: 403 })
    );
    const result = await removePasskey("key-1", options);
    expect(result.requiresReauthentication).toBe(true);
  });
});
