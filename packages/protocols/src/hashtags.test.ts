import { expect, test } from "bun:test";

import { hasHashtag, normalizeHashtag } from "./hashtags";

test("normalizes a valid hashtag without accepting queries, paths or SQL wildcards", () => {
  expect(normalizeHashtag("OnePiece")).toBe("onepiece");
  expect(normalizeHashtag("#ＯｎｅＰｉｅｃｅ")).toBe("ｏｎｅｐｉｅｃｅ");
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

test("Unicode case and canonical accents match without merging compatibility spellings", () => {
  expect(hasHashtag({ tags: ["Été"] }, "été")).toBe(true);
  expect(hasHashtag({ text: "A trip #CAFE\u0301" }, "café")).toBe(true);
  expect(hasHashtag({ tags: ["café"] }, "cafe\u0301")).toBe(true);
  expect(hasHashtag({ text: "#ＯｎｅＰｉｅｃｅ" }, "ｏｎｅｐｉｅｃｅ")).toBe(
    true
  );
  expect(hasHashtag({ text: "#ＯｎｅＰｉｅｃｅ" }, "onepiece")).toBe(false);
});

test("contextual and multi-character lowercase mappings match declared and inline hashtags", () => {
  expect(normalizeHashtag("ΟΣ")).toBe("ος");
  expect(hasHashtag({ tags: ["ΟΣ"] }, "ος")).toBe(true);
  expect(hasHashtag({ text: "A topic #ΟΣ" }, "ος")).toBe(true);
  expect(normalizeHashtag("İ")).toBe("i\u0307");
  expect(hasHashtag({ tags: ["İ"] }, "i\u0307")).toBe(true);
  expect(hasHashtag({ text: "A topic #İ" }, "i\u0307")).toBe(true);
});
