import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const values = new Map<string, string>();
let reserved = true;
let budget = 0;
let backgroundBudget = 0;
const fetchRequests: { body: Record<string, unknown>; url: string }[] = [];
const originalFetch = globalThis.fetch;
mock.module("../env", () => ({
  workerEnv: {
    CLEF_DAILY_NEURONS: 9000,
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: "test-token",
  },
}));
mock.module("@asm/db", () => ({
  redis: {
    eval: (
      script: string,
      _count: number,
      key: string,
      amountOrKey: number | string,
      reservation?: number,
      limit?: number,
      _expiry?: number,
      background?: number
    ) => {
      if (script.includes("incrbyfloat")) {
        if (
          background &&
          backgroundBudget + Number(reservation) > Number(limit) * 0.25
        ) {
          return 0;
        }
        if (reserved) {
          budget += Number(reservation ?? amountOrKey);
        }
        return reserved ? 1 : 0;
      }
      values.delete(key);
      return 1;
    },
    get: (key: string) => values.get(key) ?? null,
    incrbyfloat: (_key: string, amount: number) => {
      budget += amount;
      return String(budget);
    },
    set: (key: string, value: string | number) => {
      values.set(key, String(value));
      return "OK";
    },
  },
}));
const {
  clefSafetyVerdict,
  evaluateClef,
  parseClefResult,
  ClefDeferredError,
  withAnalysisLane,
} = await import("./clef");

function fakeResult(body: Record<string, unknown>) {
  const questions = body.questions as Record<string, unknown>;
  return {
    answers: Object.fromEntries(
      Object.keys(questions).map((key) => [
        key,
        { noul: key === "topic_anime" ? 0.95 : 0.01, type: "noul" },
      ])
    ),
    model: "clef-flash",
    usage: { input_tokens: 1200, output_tokens: 0 },
  };
}

beforeEach(() => {
  values.clear();
  budget = 0;
  backgroundBudget = 0;
  reserved = true;
  fetchRequests.length = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit
  ) => {
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    fetchRequests.push({ body, url: String(url) });
    return await Promise.resolve(
      Response.json({ result: fakeResult(body), success: true })
    );
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Clef decisions and budget", () => {
  test("uses the official typed response and caches repeated content", async () => {
    const first = await evaluateClef({
      text: "An ordinary anime illustration",
    });
    const second = await evaluateClef({
      text: "An ordinary anime illustration",
    });
    expect(fetchRequests).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first.tags).toContain("anime");
    expect(clefSafetyVerdict(first).explicit).toBe(false);
    expect(budget).toBeCloseTo((1200 * 3455) / 1_000_000, 6);
    expect(fetchRequests[0]?.url).toEndWith(
      "/ai/run/@cf/cloudflare/clef-flash"
    );
  });
  test("exhausted daily allowance defers without calling the provider", async () => {
    reserved = false;
    await expect(evaluateClef({ text: "another post" })).rejects.toBeInstanceOf(
      ClefDeferredError
    );
    expect(fetchRequests).toHaveLength(0);
  });
  test("rate limits cool down every caller and retain the request reservation", async () => {
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls += 1;
        return await Promise.resolve(
          new Response("limited", {
            headers: { "retry-after": "120" },
            status: 429,
          })
        );
      },
      { preconnect: originalFetch.preconnect }
    );
    await expect(evaluateClef({ text: "first" })).rejects.toBeInstanceOf(
      ClefDeferredError
    );
    await expect(evaluateClef({ text: "second" })).rejects.toBeInstanceOf(
      ClefDeferredError
    );
    expect(calls).toBe(1);
    expect(budget).toBe(85);
  });
  test("missing or malformed safety answers never become a safe verdict", () => {
    expect(() =>
      parseClefResult({
        answers: {},
        model: "clef-flash",
        usage: { input_tokens: 5 },
      })
    ).toThrow();
    expect(() =>
      parseClefResult({
        answers: { explicit: { noul: 2, type: "noul" } },
        model: "clef-flash",
        usage: { input_tokens: 5 },
      })
    ).toThrow();
  });
  test("positive NSFW decisions only describe the explicit label", () => {
    const verdict = clefSafetyVerdict({
      evaluatedAt: new Date().toISOString(),
      policyVersion: "clef-flash-v2",
      probabilities: { explicit: 0.99 },
      tags: ["anime"],
    });
    expect(verdict.explicit).toBe(true);
    expect(verdict).not.toHaveProperty("moderated");
    expect(verdict).not.toHaveProperty("blocked");
  });
});

test("backfill budget exhaustion reserves capacity for fresh uploads", async () => {
  backgroundBudget = 2240;
  await expect(
    withAnalysisLane(true, () => evaluateClef({ text: "old backfill" }))
  ).rejects.toBeInstanceOf(ClefDeferredError);
  const fresh = await withAnalysisLane(false, () =>
    evaluateClef({ text: "fresh upload" })
  );
  expect(fresh.tags).toContain("anime");
});
