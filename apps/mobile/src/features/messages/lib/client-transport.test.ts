import { describe, expect, test } from "bun:test";

import {
  fetchIdentity,
  fetchMessages,
  fetchUnreadMessageCount,
} from "./client";
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

test("cancelling a history read still aborts its own transport", async () => {
  const controller = new AbortController();
  let transportAborted = false;
  const baseFetch: typeof fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      // oxlint-disable-next-line promise/avoid-new -- this transport stays pending until its abort signal rejects it
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            transportAborted = true;
            reject(
              Object.assign(new Error("Cancelled history read"), {
                name: "AbortError",
              })
            );
          },
          { once: true }
        );
      }),
    { preconnect: fetch.preconnect }
  );
  const pending = fetchMessages(
    "conversation",
    undefined,
    {
      apiBase: "https://messages.invalid",
      baseFetch,
    },
    30,
    { signal: controller.signal }
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(transportAborted).toBe(true);
});

test("a failed unread-count request cannot masquerade as an authoritative zero badge", async () => {
  const baseFetch: typeof fetch = Object.assign(
    () =>
      Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 })),
    { preconnect: fetch.preconnect }
  );
  await expect(
    fetchUnreadMessageCount({ apiBase: "https://messages.invalid", baseFetch })
  ).rejects.toMatchObject({ status: 503 });
});
