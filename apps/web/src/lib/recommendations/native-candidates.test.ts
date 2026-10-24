import { expect, mock, test } from "bun:test";

const rawQuery = mock((_sql: string, parameters: unknown[]) =>
  Promise.resolve({
    rows: [{ id: JSON.stringify(parameters.slice(0, 4)) }],
  })
);
mock.module("@asm/db", () => ({
  networkSql: { pagedCandidates: "fixture-sql" },
  rawQuery,
  redis: {
    eval: () => Promise.resolve(1),
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
  },
}));
const { nativeCandidateIds } = await import("./native-candidates");

test("concurrent viewers share candidate retrieval but policy, format, modes and continuation remain isolated", async () => {
  const options = {
    anchor: new Date().toISOString(),
    continuation: false,
    explicit: false,
    gust: false,
    mode: "personalized" as const,
    offset: 0,
    seeds: ["software"],
    signal: AbortSignal.timeout(3000),
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, () => nativeCandidateIds(options))
  );
  expect(rawQuery).toHaveBeenCalledTimes(1);
  expect(
    results.every((result) => result.rows[0]?.id === results[0].rows[0]?.id)
  ).toBe(true);
  await nativeCandidateIds({ ...options, seeds: ["gardening"] });
  await nativeCandidateIds({ ...options, explicit: true });
  await nativeCandidateIds({ ...options, gust: true });
  await nativeCandidateIds({ ...options, mode: "latest" });
  expect(rawQuery).toHaveBeenCalledTimes(5);
  await nativeCandidateIds({ ...options, continuation: true, offset: 180 });
  await nativeCandidateIds({ ...options, continuation: true, offset: 180 });
  expect(rawQuery).toHaveBeenCalledTimes(7);
  expect(rawQuery.mock.calls.at(-1)?.[1][4]).toBe(180);
});
