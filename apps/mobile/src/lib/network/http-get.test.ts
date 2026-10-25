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
