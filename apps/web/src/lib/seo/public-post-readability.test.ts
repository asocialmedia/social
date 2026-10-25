import { expect, test } from "bun:test";

import { publicPostReadable } from "./public-post-readability";

test("public SEO eligibility checks tags, attachment text and embedded previews", () => {
  expect(publicPostReadable({ content: "A normal public conversation" })).toBe(
    true
  );
  expect(publicPostReadable({ postToTags: [{ tag: { name: "porn" } }] })).toBe(
    false
  );
  expect(publicPostReadable({ postMedias: [{ altText: "#porn" }] })).toBe(
    false
  );
  expect(
    publicPostReadable({
      embeds: [{ title: "#porn", type: "link", url: "https://example.com" }],
    })
  ).toBe(false);
});
