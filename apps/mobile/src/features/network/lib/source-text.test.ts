import { expect, test } from "bun:test";

import { externalInlineSegments } from "./source-text";

test("keeps source mention identity distinct from links and hashtags", () => {
  expect(
    externalInlineSegments([
      { href: "https://bsky.app/profile/did:plc:alice", text: "@alice.test" },
      { text: " says #webdev " },
      { href: "https://example.test/article", text: "read this" },
    ])
  ).toEqual([
    { actor: "did:plc:alice", type: "mention", username: "alice.test" },
    { text: " says ", type: "text" },
    { tag: "webdev", type: "tag" },
    { text: " ", type: "text" },
    { label: "read this", type: "url", url: "https://example.test/article" },
  ]);
});
