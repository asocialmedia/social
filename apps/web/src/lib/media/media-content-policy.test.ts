import { expect, test } from "bun:test";

import { mediaContentIsExplicit } from "./media-content-policy";

test("media inherits known safety from its own classification, text, post and comment ancestors", () => {
  expect(mediaContentIsExplicit({ safety: { explicit: true } })).toBe(true);
  expect(
    mediaContentIsExplicit({
      post: { content: "#porn", explicitContent: false },
    })
  ).toBe(true);
  expect(
    mediaContentIsExplicit({ comment: { post: { explicitContent: true } } })
  ).toBe(true);
  expect(mediaContentIsExplicit({ comment: { content: "#nsfw" } })).toBe(true);
  expect(mediaContentIsExplicit({ ocrText: "#hentai" })).toBe(true);
  expect(
    mediaContentIsExplicit({
      post: { content: "TypeScript compiler tutorial" },
      safety: { explicit: false },
    })
  ).toBe(false);
});
