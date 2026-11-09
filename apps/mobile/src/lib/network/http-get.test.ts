import { describe, expect, test } from "bun:test";

import { getWithTimeout, RequestTimeoutError } from "./http-get";

describe("getWithTimeout", () => {
  test("deduplicates overlapping GETs without sharing consumed bodies", async () => {
    let calls = 0;
    const baseFetch = (async () => {
      calls += 1;
      await Promise.resolve();
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const [first, second] = await Promise.all([
      getWithTimeout("https://api.test/dedupe", {}, { baseFetch }),
      getWithTimeout("https://api.test/dedupe", {}, { baseFetch }),
    ]);
    expect(calls).toBe(1);
    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true });
  });

  test("keys cookies separately", async () => {
    let calls = 0;
    const baseFetch = (async () => {
      calls += 1;
      // The test needs a real timer to keep the two requests overlapping.
      // oxlint-disable-next-line promise/avoid-new, eslint/no-promise-executor-return
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    await Promise.all([
      getWithTimeout(
        "https://api.test/private",
        { headers: { cookie: "a=1" } },
        { baseFetch }
      ),
      getWithTimeout(
        "https://api.test/private",
        { headers: { cookie: "b=2" } },
        { baseFetch }
      ),
    ]);
    expect(calls).toBe(2);
  });

  test("rejects timed-out requests", async () => {
    const baseFetch = (() =>
      // The unresolved promise verifies the helper's own timeout deadline.
      // oxlint-disable-next-line promise/avoid-new
      new Promise<Response>(() => {
        // Deliberately never settles: the helper's own deadline must win.
      })) as unknown as typeof fetch;
    await expect(
      getWithTimeout("https://api.test/slow", {}, { baseFetch, timeoutMs: 5 })
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  test("rejects non-GET methods", () => {
    expect(() =>
      getWithTimeout("https://api.test/write", { method: "POST" })
    ).toThrow(TypeError);
  });
});

test("body-aware deduplication buffers once and gives independent completed responses", async () => {
  let calls = 0;
  const baseFetch = (async () => {
    calls += 1;
    await Promise.resolve();
    return Response.json({ posts: ["one"] });
  }) as unknown as typeof fetch;
  const options = { baseFetch, readBody: true };
  const [first, second] = await Promise.all([
    getWithTimeout("https://api.test/body", {}, options),
    getWithTimeout("https://api.test/body", {}, options),
  ]);
  expect(calls).toBe(1);
  expect(await first.json()).toEqual({ posts: ["one"] });
  expect(await second.json()).toEqual({ posts: ["one"] });
});

// A fetch the test releases by hand, recording whether its signal fired.
function gatedFetch() {
  const state = { aborted: false, calls: 0 };
  let release: (() => void) | null = null;
  const baseFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    state.calls += 1;
    // oxlint-disable-next-line promise/avoid-new -- the test controls when the response lands
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        state.aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
      release = () => resolve(Response.json({ ok: true }));
    });
  }) as unknown as typeof fetch;
  return { baseFetch, release: () => release?.(), state };
}

describe("caller abort signals", () => {
  test("one caller leaving does not cancel the read for another", async () => {
    const gate = gatedFetch();
    const leaving = new AbortController();
    const first = getWithTimeout(
      "https://api.test/shared",
      { signal: leaving.signal },
      { baseFetch: gate.baseFetch }
    );
    const second = getWithTimeout(
      "https://api.test/shared",
      {},
      { baseFetch: gate.baseFetch }
    );
    leaving.abort();
    await expect(first).rejects.toThrow();
    expect(gate.state.aborted).toBe(false);
    gate.release();
    const response = await second;
    expect(await response.json()).toEqual({ ok: true });
    expect(gate.state.calls).toBe(1);
  });

  test("the read is cancelled once every caller has left", async () => {
    const gate = gatedFetch();
    const a = new AbortController();
    const b = new AbortController();
    const first = getWithTimeout(
      "https://api.test/abandoned",
      { signal: a.signal },
      { baseFetch: gate.baseFetch }
    );
    const second = getWithTimeout(
      "https://api.test/abandoned",
      { signal: b.signal },
      { baseFetch: gate.baseFetch }
    );
    a.abort();
    b.abort();
    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(gate.state.aborted).toBe(true);
  });

  test("an already aborted signal rejects without a request", async () => {
    const gate = gatedFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(
      getWithTimeout(
        "https://api.test/never",
        { signal: controller.signal },
        { baseFetch: gate.baseFetch }
      )
    ).rejects.toThrow();
    expect(gate.state.calls).toBe(0);
  });
});
