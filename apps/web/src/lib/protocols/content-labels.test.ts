import { expect, test } from "bun:test";

import { blueskyMediaIsExplicit, postHasExplicitMedia } from "./content-labels";

test.each(["porn", "sexual", "graphic-media", "nudity", "nsfw", "adult"])(
  "%s maps post and account labels to ASM's explicit-media marker",
  (label) => {
    expect(blueskyMediaIsExplicit({ labels: [label] })).toBe(true);
    expect(blueskyMediaIsExplicit({ selfLabels: [label] })).toBe(true);
    expect(blueskyMediaIsExplicit({ author: { labels: [label] } })).toBe(true);
  }
);

test.each(["!warn", "!no-unauthenticated", "!hide", "spam", "custom-label"])(
  "%s is not reclassified as explicit media",
  (label) => {
    expect(blueskyMediaIsExplicit({ labels: [label] })).toBe(false);
  }
);

test("identifies explicit tags and hashtags even without formal platform labels", () => {
  expect(blueskyMediaIsExplicit({ tags: ["nsfw"] })).toBe(true);
  expect(blueskyMediaIsExplicit({ tags: ["18+"] })).toBe(true);
  expect(blueskyMediaIsExplicit({ tags: ["r18"] })).toBe(true);
  expect(blueskyMediaIsExplicit({ text: "Artwork check out #nsfw" })).toBe(
    true
  );
  expect(blueskyMediaIsExplicit({ text: "Photo of flowers" })).toBe(false);
});

test("missing or repeated labels are safe and source labels remain unchanged", () => {
  const labels = ["custom-label", "nudity", "nudity"];
  expect(blueskyMediaIsExplicit({ labels })).toBe(true);
  expect(labels).toEqual(["custom-label", "nudity", "nudity"]);
  expect(blueskyMediaIsExplicit({})).toBe(false);
});

test("preserves native explicit flags and repairs old external presentation flags", () => {
  expect(postHasExplicitMedia({ explicitContent: true })).toBe(true);
  expect(postHasExplicitMedia({ explicitContent: false })).toBe(false);
  expect(
    postHasExplicitMedia({
      explicitContent: false,
      external: { labels: ["porn"] },
    })
  ).toBe(true);
});
