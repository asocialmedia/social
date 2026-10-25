import { expect, mock, test } from "bun:test";

const values = new Map<string, string>();
mock.module("../../redis", () => ({
  redis: {
    get: (key: string) => Promise.resolve(values.get(key) ?? null),
    hget: (key: string, post: string) =>
      Promise.resolve(values.get(`${key}:${post}`) ?? null),
    set: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve("OK");
    },
  },
}));
const {
  rankingAssignment,
  resolveRankingContext,
  rememberRankingImpression,
  resolveLastRankingContext,
} = await import("./attribution");

test("stable opt-in experiments default to control", () => {
  expect(rankingAssignment("u", 0).variant).toBe("control");
  expect(rankingAssignment("u", 100).variant).toBe("balanced");
  expect(rankingAssignment("u", 25)).toEqual(rankingAssignment("u", 25));
});

test("ranking context comes only from the viewer's served page and qualified impression", async () => {
  const requestId = crypto.randomUUID();
  const context = {
    experiment: "balanced-v1",
    position: 4,
    rankerVersion: "v3",
    requestId,
    sources: ["semantic"],
    variant: "control",
  };
  values.set(`rec:exposure:v1:u:${requestId}:post`, JSON.stringify(context));
  expect(await resolveRankingContext("u", "post", requestId)).toEqual(context);
  expect(await resolveRankingContext("other", "post", requestId)).toBeNull();
  expect(await resolveRankingContext("u", "not-served", requestId)).toBeNull();
  expect(await resolveLastRankingContext("u", "post")).toBeNull();
  await rememberRankingImpression("u", "post", context);
  expect(await resolveLastRankingContext("u", "post")).toEqual(context);
  values.set(`rec:exposure:v1:u:${requestId}:post`, "invalid JSON");
  expect(await resolveRankingContext("u", "post", requestId)).toBeNull();
});
