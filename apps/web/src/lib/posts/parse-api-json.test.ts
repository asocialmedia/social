import { expect, test } from "bun:test";

import { parseApiJson } from "./parse-api-json";

test("bookmark timestamps revive without changing nested Bluesky records", () => {
  const createdAt = "2026-10-18T10:00:00.000Z";
  const external = {
    author: { createdAt },
    createdAt,
    indexedAt: createdAt,
    source: "bluesky",
  };
  expect(
    parseApiJson(
      JSON.stringify({ checkedAt: null, posts: [{ createdAt, external }] })
    )
  ).toEqual({
    checkedAt: null,
    posts: [{ createdAt: new Date(createdAt), external }],
  });
});

test("does not corrupt arbitrary At fields or already parsed Dates", () => {
  expect(parseApiJson('{"captionAt":"hello","deletedAt":null}')).toEqual({
    captionAt: "hello",
    deletedAt: null,
  });
});
