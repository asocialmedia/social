import { expect, test } from "bun:test";

import { hasHashtag, normalizeHashtag } from "./hashtags";

test("normalizes a valid hashtag without accepting queries, paths or SQL wildcards", () => {
  expect(normalizeHashtag("OnePiece")).toBe("onepiece");
  expect(normalizeHashtag("#ＯｎｅＰｉｅｃｅ")).toBe("onepiece");
  expect(normalizeHashtag("写真")).toBe("写真");
  for (const tag of [
    "",
    "a b",
    "../onepiece",
    "onepiece%",
    "onepiece?sort=top",
    "x".repeat(65),
  ]) {
    expect(normalizeHashtag(tag)).toBeNull();
  }
});

test("matches declared tags, facets and complete text hashtags without substring matches", () => {
  expect(hasHashtag({ tags: ["OnePiece"] }, "onepiece")).toBe(true);
  expect(hasHashtag({ facets: { tags: ["ONEPIECE"] } }, "onepiece")).toBe(true);
  expect(hasHashtag({ content: "A drawing #OnePiece!" }, "onepiece")).toBe(
    true
  );
  expect(hasHashtag({ text: "#写真 #onepiece" }, "写真")).toBe(true);
  for (const content of [
    "onepiece discussion",
    "#onepiecefan",
    "#onepiece_art",
    "#notonepiece",
  ]) {
    expect(hasHashtag({ content }, "onepiece")).toBe(false);
  }
});
