import { describe, expect, test } from "bun:test";

import { fetchFeedHead, fetchFeedHeadId } from "./feed-api";

// The new-content probe runs every 45 seconds per open client, so what it costs
// when nothing has happened is the whole point of these: a page of twenty
// viewer-resolved posts, or one row.
function jsonResponse(payload: unknown): Response {
  return Response.json(payload, {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function recordingFetch(body: unknown) {
  const calls: string[] = [];
  const baseFetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(jsonResponse(body));
  }) as unknown as typeof fetch;
  return { baseFetch, calls };
}

const OPTIONS = { apiBase: "https://api.test" };

// A feed route that is down. The probe swallows this; the helper still has to
// reject rather than report an empty head as "nothing new".
const failingFetch = (() =>
  Promise.resolve(
    new Response("nope", { status: 503 })
  )) as unknown as typeof fetch;

describe("fetchFeedHeadId", () => {
  test("asks the route for a single row on the variants that support it", async () => {
    const { baseFetch, calls } = recordingFetch({ posts: [{ id: "p-1" }] });

    const id = await fetchFeedHeadId("latest", { ...OPTIONS, baseFetch });

    expect(id).toBe("p-1");
    expect(calls[0]).toBe("https://api.test/api/posts/latest?take=1");
  });

  test("does not add a parameter a route would ignore", async () => {
    // trending and following do not read ?take=, so sending it would imply a
    // cheap probe that is not actually cheap.
    const { baseFetch, calls } = recordingFetch({ posts: [{ id: "p-1" }] });
    const variants = [
      ["trending", "/api/posts/trending"],
      ["following", "/api/posts/following"],
    ] as const;

    const ids = await Promise.all(
      variants.map(([variant]) =>
        fetchFeedHeadId(variant, { ...OPTIONS, baseFetch })
      )
    );

    expect(ids).toEqual(["p-1", "p-1"]);
    expect(calls).toEqual([
      "https://api.test/api/posts/trending",
      "https://api.test/api/posts/following",
    ]);
  });

  test("returns null when the viewer can see nothing, which is a real answer", async () => {
    const { baseFetch } = recordingFetch({ posts: [] });
    expect(
      await fetchFeedHeadId("latest", { ...OPTIONS, baseFetch })
    ).toBeNull();
  });

  test("survives a malformed payload instead of throwing", async () => {
    const { baseFetch } = recordingFetch({ posts: "not-an-array" });
    expect(
      await fetchFeedHeadId("latest", { ...OPTIONS, baseFetch })
    ).toBeNull();
  });

  test("rejects on a failed request, so the probe can stay silent about it", async () => {
    await expect(
      fetchFeedHeadId("latest", { ...OPTIONS, baseFetch: failingFetch })
    ).rejects.toThrow("Feed request failed (503)");
  });

  test("still returns a whole page from fetchFeedHead, for the fetch-on-change tier", async () => {
    const { baseFetch, calls } = recordingFetch({
      posts: [{ id: "p-1" }, { id: "p-2" }],
    });

    const posts = await fetchFeedHead("latest", { ...OPTIONS, baseFetch });

    expect(posts).toHaveLength(2);
    expect(calls[0]).toBe("https://api.test/api/posts/latest");
  });
});
