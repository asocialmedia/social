import { describe, expect, test } from "bun:test";

import { fetchSupportPolicy } from "./support-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    headers: { "content-type": "application/json" },
    status,
  });
}

const OPTIONS = { apiBase: "https://api.test" };

function recordingFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const baseFetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(jsonResponse(body, status));
  }) as unknown as typeof fetch;
  return { baseFetch, calls };
}

describe("fetchSupportPolicy", () => {
  test("reads the floor the server publishes", async () => {
    const { baseFetch, calls } = recordingFetch({
      latest: "0.1.21",
      minimumSupported: "0.1.18",
    });

    const policy = await fetchSupportPolicy({ ...OPTIONS, baseFetch });

    expect(policy).toEqual({ minimumSupported: "0.1.18" });
    expect(calls[0]).toBe("https://api.test/api/mobile/version");
  });

  test("a server with no floor configured reports no floor", async () => {
    const { baseFetch } = recordingFetch({ latest: "0.1.21" });
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      minimumSupported: null,
    });
  });

  test("a failed check is never a retirement", async () => {
    // An offline launch or a bad gateway must not lock anyone out of the app:
    // no floor means every build is supported.
    const { baseFetch } = recordingFetch({ error: "nope" }, 503);
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      minimumSupported: null,
    });
  });

  test("a malformed body is never a retirement", async () => {
    const { baseFetch } = recordingFetch("not-an-object");
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      minimumSupported: null,
    });
  });

  test("a non-string floor is ignored rather than compared", async () => {
    const { baseFetch } = recordingFetch({ minimumSupported: 18 });
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      minimumSupported: null,
    });
  });
});
