import { expect, test } from "bun:test";

import {
  loadReactionCatalog,
  QUICK_MESSAGE_REACTIONS,
  searchReactionEmojis,
} from "./reactions";

test("the catalog covers Unicode categories and excludes standalone components", async () => {
  const catalog = await loadReactionCatalog();
  expect(catalog.emojis.length).toBeGreaterThan(1800);
  expect(QUICK_MESSAGE_REACTIONS).toHaveLength(5);
  expect(catalog.allowed.has("❤️‍🔥")).toBe(true);
  expect(catalog.allowed.has("🇮🇳")).toBe(true);
  expect(catalog.allowed.has("🏽")).toBe(false);
});

test("search matches names, keywords, and exact skin-tone emoji across categories", async () => {
  const catalog = await loadReactionCatalog();
  expect(
    searchReactionEmojis(catalog, "pizza", 0).some(
      (entry) => entry.emoji === "🍕"
    )
  ).toBe(true);
  expect(
    searchReactionEmojis(catalog, "thumbs_up", 0, 3).some(
      (entry) => entry.emoji === "👍🏽"
    )
  ).toBe(true);
  expect(
    searchReactionEmojis(catalog, "👍🏿", 0).map((entry) => entry.emoji)
  ).toEqual(["👍🏿"]);
  expect(searchReactionEmojis(catalog, "unfindableqzx", 0)).toEqual([]);
  expect(
    searchReactionEmojis(catalog, "", 9).every((entry) => entry.group === 9)
  ).toBe(true);
});
