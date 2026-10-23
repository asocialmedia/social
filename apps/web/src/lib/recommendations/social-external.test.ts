import { beforeEach, expect, mock, test } from "bun:test";

const candidates = Array.from({ length: 30 }, (_, index) => ({
  id: `post-${index}`,
  sources: [],
  weight: index / 30,
}));
const hydrate = mock((_ids: string[], _signal: AbortSignal) =>
  Promise.resolve([])
);
const background: (() => Promise<void>)[] = [];
mock.module("@asm/db", () => ({
  networkSocialCandidates: () => Promise.resolve({ external: candidates }),
}));
mock.module("@/lib/protocols/service", () => ({ readBlueskyPosts: hydrate }));
mock.module("next/server", () => ({
  after: (work: () => Promise<void>) => background.push(work),
}));
const { socialExternalRecommendations } = await import("./social-external");
beforeEach(() => {
  hydrate.mockClear();
  background.length = 0;
  hydrate.mockImplementation(() => Promise.resolve([]));
});

test("followed amplifications hydrate the strongest candidates inside the protocol batch limit", async () => {
  await socialExternalRecommendations(
    "viewer",
    true,
    new AbortController().signal,
    "test"
  );
  const [[ids, signal]] = hydrate.mock.calls;
  expect(ids).toHaveLength(25);
  expect(ids[0]).toBe("post-29");
  expect(ids).not.toContain("post-0");
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(background).toHaveLength(0);
});

test("optional graph failures warm in the background instead of failing healthy discovery", async () => {
  hydrate.mockImplementation(() =>
    Promise.reject(new Error("temporary outage"))
  );
  const result = await socialExternalRecommendations(
    "viewer",
    true,
    new AbortController().signal,
    "test"
  );
  expect(result.partial).toBe(true);
  expect(result.items).toEqual([]);
  expect(background).toHaveLength(1);
  await background[0]();
  expect(hydrate).toHaveBeenCalledTimes(2);
});

test("continuation annotations do not rehydrate graph candidates", async () => {
  const result = await socialExternalRecommendations(
    "viewer",
    false,
    new AbortController().signal,
    "test"
  );
  expect(hydrate).not.toHaveBeenCalled();
  expect(result.weights.size).toBe(30);
});
