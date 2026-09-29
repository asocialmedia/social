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

    const check = await fetchSupportPolicy({ ...OPTIONS, baseFetch });

    expect(check).toEqual({
      ok: true,
      policy: { minimumSupported: "0.1.18" },
    });
    expect(calls[0]).toBe("https://api.test/api/mobile/version");
  });

  test("a server with no floor configured is a real answer", async () => {
    // This is the one completed check that is allowed to lift a gate: the
    // server was reached and said every build is supported.
    const { baseFetch } = recordingFetch({ latest: "0.1.21" });
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      ok: true,
      policy: { minimumSupported: null },
    });
  });

  test("a failed check is not an answer at all", async () => {
    // The distinction that matters: an unreachable server must not be reported
    // as "no floor", or a retry after a confirmed retirement would quietly
    // un-retire the build and close the gate.
    const { baseFetch } = recordingFetch({ error: "nope" }, 503);
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      ok: false,
    });
  });

  test("a malformed body is not an answer either", async () => {
    const { baseFetch } = recordingFetch("not-an-object");
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      ok: false,
    });
  });

  test("a 200 whose body is unreadable is not an answer", async () => {
    const baseFetch = (() =>
      Promise.resolve(
        new Response("<html>502</html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        })
      )) as unknown as typeof fetch;
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      ok: false,
    });
  });

  test("a thrown request is not an answer", async () => {
    const baseFetch = (() =>
      Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      ok: false,
    });
  });

  test("a non-string floor in a valid body reads as no floor", async () => {
    const { baseFetch } = recordingFetch({ minimumSupported: 18 });
    expect(await fetchSupportPolicy({ ...OPTIONS, baseFetch })).toEqual({
      ok: true,
      policy: { minimumSupported: null },
    });
  });
});
