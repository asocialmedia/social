import { expect, test } from "bun:test";

import { normalizePost } from "./bluesky/normalize";
import { postViewSchema } from "./bluesky/schemas";
import { externalPostSchema } from "./discovery";
import {
  externalAiDeclaration,
  externalPostTopics,
  externalRegionalRelevance,
  externalTopicMatch,
  mergeTopicWeights,
} from "./post-metadata";
import { postFixture } from "./testing/fixtures";

const post = () => normalizePost(postViewSchema.parse(postFixture));

test("explicit media opt-in keeps warning labels but never bypasses access restrictions", () => {
  for (const value of ["porn", "sexual", "graphic-media", "nudity"]) {
    const raw = postViewSchema.parse({
      ...postFixture,
      labels: [{ val: value }],
    });
    expect(() => normalizePost(raw)).toThrow();
    expect(normalizePost(raw, 0, true).labels).toContain(value);
    expect(() =>
      normalizePost(
        postViewSchema.parse({
          ...postFixture,
          labels: [{ val: value }, { val: "!no-unauthenticated" }],
        }),
        0,
        true
      )
    ).toThrow();
  }
});

test("metadata survives normalization, snapshots and nested quotes without changing old snapshot requirements", () => {
  const raw = {
    ...postFixture,
    record: {
      ...postFixture.record,
      facets: [
        {
          features: [{ $type: "app.bsky.richtext.facet#tag", tag: "Space" }],
          index: { byteEnd: 10, byteStart: 4 },
        },
        {
          features: [
            {
              $type: "app.bsky.richtext.facet#link",
              uri: "https://nasa.gov/news",
            },
          ],
          index: { byteEnd: 15, byteStart: 11 },
        },
        {
          features: [
            { $type: "app.bsky.richtext.facet#mention", did: "did:plc:alice" },
          ],
          index: { byteEnd: 22, byteStart: 16 },
        },
      ],
      labels: {
        $type: "com.atproto.label.defs#selfLabels",
        values: [{ val: "ai-generated" }],
      },
      langs: ["en-IN"],
      reply: {
        parent: { uri: postFixture.uri },
        root: { uri: postFixture.uri },
      },
      tags: ["Astronomy"],
      text: "✨ #Space link @alice",
    },
  };
  const value = normalizePost(postViewSchema.parse(raw));
  expect(value.facets).toEqual({
    links: ["https://nasa.gov/news"],
    mentions: ["did:plc:alice"],
    tags: ["Space"],
  });
  expect(value.tags).toEqual(["Astronomy"]);
  expect(value.selfLabels).toEqual(["ai-generated"]);
  expect(value.replyRoot).toBe(postFixture.uri);
  expect(externalPostSchema.parse({ ...value, quote: value }).quote).toEqual(
    value
  );
  const {
    tags: _tags,
    facets: _facets,
    selfLabels: _selfLabels,
    replyRoot: _root,
    ...oldSnapshot
  } = value;
  expect(externalPostSchema.safeParse(oldSnapshot).success).toBe(true);
});

test("invalid byte ranges, unsafe URLs and overlapping facets cannot add recommendation metadata", () => {
  const value = normalizePost(
    postViewSchema.parse({
      ...postFixture,
      record: {
        ...postFixture.record,
        facets: [
          {
            features: [
              { $type: "app.bsky.richtext.facet#tag", tag: "invalid" },
            ],
            index: { byteEnd: 3, byteStart: 1 },
          },
          {
            features: [{ $type: "app.bsky.richtext.facet#tag", tag: "Space" }],
            index: { byteEnd: 10, byteStart: 4 },
          },
          {
            features: [
              { $type: "app.bsky.richtext.facet#tag", tag: "overlap" },
            ],
            index: { byteEnd: 10, byteStart: 5 },
          },
          {
            features: [
              { $type: "app.bsky.richtext.facet#tag", tag: "outside" },
            ],
            index: { byteEnd: 60, byteStart: 50 },
          },
        ],
        text: "✨ #Space",
      },
    })
  );
  expect(value.facets?.tags).toEqual(["Space"]);
  const unsafe = normalizePost(
    postViewSchema.parse({
      ...postFixture,
      record: {
        ...postFixture.record,
        facets: [
          {
            features: [
              {
                $type: "app.bsky.richtext.facet#link",
                uri: "http://localhost/private",
              },
            ],
            index: { byteEnd: 5, byteStart: 0 },
          },
        ],
      },
    })
  );
  expect(unsafe.facets?.links).toEqual([]);
});

test("AI declarations survive while warning, access, adult and unknown labels still enforce visibility", () => {
  const value = normalizePost(
    postViewSchema.parse({ ...postFixture, labels: [{ val: "ai-generated" }] })
  );
  expect(externalAiDeclaration(value)).toBe(true);
  for (const label of [
    "porn",
    "sexual",
    "graphic-media",
    "nudity",
    "!warn",
    "!no-unauthenticated",
    "!hide",
    "custom-warning",
  ]) {
    expect(() =>
      normalizePost(
        postViewSchema.parse({
          ...postFixture,
          record: {
            ...postFixture.record,
            labels: {
              $type: "com.atproto.label.defs#selfLabels",
              values: [{ val: label }],
            },
          },
        })
      )
    ).toThrow("not available through public discovery");
    expect(() =>
      normalizePost(
        postViewSchema.parse({
          ...postFixture,
          labels: [{ val: "ai-generated" }, { val: label }],
        })
      )
    ).toThrow();
  }
  const topicOnly = { ...post(), tags: ["ai-generated"], text: "AI artwork" };
  expect(externalAiDeclaration(topicOnly)).toBe(false);
  expect(
    externalAiDeclaration(
      normalizePost(
        postViewSchema.parse({
          ...postFixture,
          labels: [
            { neg: true, val: "ai-generated" },
            { exp: "2000-01-01T00:00:00Z", val: "ai-generated" },
          ],
        })
      )
    )
  ).toBe(false);
});

test("explicit topics outrank alt text, links are domain signals, and short terms do not match unrelated words", () => {
  const value = {
    ...post(),
    facets: {
      links: ["https://www.nasa.gov/news"],
      mentions: [],
      tags: ["Astronomy"],
    },
    media: [
      {
        alt: "Gardening in a greenhouse",
        type: "image" as const,
        url: "https://cdn.bsky.app/image.jpg",
      },
    ],
    tags: ["#Space", "SPACE"],
    text: "Chair design",
  };
  expect(externalPostTopics(value)).toEqual(["space", "astronomy"]);
  expect(externalTopicMatch(value, "space")).toBe(1);
  expect(externalTopicMatch(value, "gardening")).toBe(0.35);
  expect(externalTopicMatch(value, "nasa.gov")).toBe(0.25);
  expect(externalTopicMatch(value, "ai")).toBe(0);
  expect(
    mergeTopicWeights({ "#Space": 2 }, { SPACE: 3 }, { space: 4 })
  ).toEqual({ space: 9 });
});

test("regional relevance uses declared regional languages and content, never a language-to-country guess or author bio", () => {
  expect(
    externalRegionalRelevance({ ...post(), languages: ["en"] }, "en-IN")
  ).toBe(0);
  expect(
    externalRegionalRelevance({ ...post(), languages: ["en-IN"] }, "en-IN")
  ).toBe(1);
  expect(
    externalRegionalRelevance({ ...post(), languages: ["zh-Hant-TW"] }, "zh-TW")
  ).toBe(1);
  expect(
    externalRegionalRelevance({ ...post(), tags: ["India"] }, "en-IN")
  ).toBe(2);
  expect(
    externalRegionalRelevance({ ...post(), text: "News from Brazil" }, "pt-BR")
  ).toBe(2);
  expect(
    externalRegionalRelevance(
      {
        ...post(),
        author: { ...post().author, description: "Lives in India" },
      },
      "en-IN"
    )
  ).toBe(0);
  expect(externalRegionalRelevance(post(), "invalid_locale")).toBe(0);
});
