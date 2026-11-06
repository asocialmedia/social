// oxlint-disable no-script-url -- Unsafe fixture URLs must be rejected.
import { expect, test } from "bun:test";

import { postFixture } from "../testing/fixtures";
import { normalizePost } from "./normalize";
import { postViewSchema } from "./schemas";

const card = {
  $type: "app.bsky.embed.external#view",
  external: {
    description: "Product details from Bluesky",
    thumb:
      "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:artist/cid@jpeg",
    title: "Handmade fox pin",
    uri: "https://ko-fi.com/s/8b62fc25c7",
  },
};

test.each([false, true])(
  "keeps Bluesky website metadata when nested inside a quote: %s",
  (nested) => {
    const post = normalizePost(
      postViewSchema.parse({
        ...postFixture,
        embed: nested
          ? {
              $type: "app.bsky.embed.recordWithMedia#view",
              media: card,
              record: {},
            }
          : card,
      })
    );
    expect(post.externalLink).toEqual({
      description: card.external.description,
      thumbnailUrl: card.external.thumb,
      title: card.external.title,
      url: card.external.uri,
    });
  }
);

test("a nested website card still rejects unsafe destinations", () => {
  const post = normalizePost(
    postViewSchema.parse({
      ...postFixture,
      embed: {
        $type: "app.bsky.embed.recordWithMedia#view",
        media: {
          ...card,
          external: {
            ...card.external,
            uri: "javascript:alert(1)",
          },
        },
        record: {},
      },
    })
  );
  expect(post.externalLink).toBeUndefined();
});
