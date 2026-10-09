import { describe, expect, test } from "bun:test";

import { fetchIdentity } from "./client";
import { HistoryThrottledError } from "./history-throttle";

describe("message reads", () => {
  test("overlapping identity reads share transport but each receives parsed JSON", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = Object.assign(
      async () => {
        calls += 1;
        await Bun.sleep(5);
        return Response.json({ identity: null });
      },
      { preconnect: fetch.preconnect }
    );
    const options = {
      apiBase: "https://messages.invalid",
      baseFetch,
      cookie: "session_token=one",
    };
    const results = await Promise.all([
      fetchIdentity(options),
      fetchIdentity(options),
    ]);
    expect(calls).toBe(1);
    expect(results).toEqual([{ identity: null }, { identity: null }]);
  });
  test("account credentials isolate overlapping identity reads", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = Object.assign(
      async () => {
        calls += 1;
        await Bun.sleep(5);
        return Response.json({ identity: null });
      },
      { preconnect: fetch.preconnect }
    );
    await Promise.all(
      ["one", "two"].map((token) =>
        fetchIdentity({
          apiBase: "https://messages.invalid",
          baseFetch,
          cookie: `session_token=${token}`,
        })
      )
    );
    expect(calls).toBe(2);
  });
  test("a throttle preserves the server retry delay and releases the shared GET", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = Object.assign(
      () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? Response.json(
                { error: "rate limited" },
                { headers: { "retry-after": "60" }, status: 429 }
              )
            : Response.json({ identity: null })
        );
      },
      { preconnect: fetch.preconnect }
    );
    const options = { apiBase: "https://messages.invalid", baseFetch };
    try {
      await fetchIdentity(options);
      throw new Error("Expected a throttle");
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryThrottledError);
      if (error instanceof HistoryThrottledError) {
        expect(error.retryAfterSeconds).toBe(60);
      }
    }
    expect(await fetchIdentity(options)).toEqual({ identity: null });
    expect(calls).toBe(2);
  });
});
