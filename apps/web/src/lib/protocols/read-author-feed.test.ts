import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { readAuthorFeedWindow } from "./read-author-feed";

function post(id: string): ExternalPost {
  return {
    author: {
      displayName: "Author",
      handle: "author.test",
      id: "did:plc:author",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/author.test",
    },
    createdAt: "2026-10-25T00:00:00Z",
    id: `at://did:plc:author/app.bsky.feed.post/${id}`,
    indexedAt: "2026-10-25T00:00:00Z",
    labels: [],
    languages: ["en"],
    media: [],
    revision: id,
    segments: [{ text: id }],
    source: "bluesky",
    text: id,
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: `https://bsky.app/profile/author.test/post/${id}`,
  };
}

test("a profile advances past empty filtered pages and pinned repeats", async () => {
  const cursors: (string | null)[] = [];
  const pinned = post("pinned");
  const result = await readAuthorFeedWindow(
    (cursor) => {
      cursors.push(cursor);
      if (cursor === null) {
        return Promise.resolve({ cursor: "second", items: [pinned] });
      }
      return Promise.resolve(
        cursor === "second"
          ? { cursor: "third", items: [] }
          : { cursor: "fourth", items: [pinned, post("older")] }
      );
    },
    null,
    new Set([pinned.id])
  );
  expect(cursors).toEqual([null, "second", "third"]);
  expect(result.items.map((item) => item.text)).toEqual(["older"]);
  expect(result.cursor).toBe("fourth");
});

test("author cursors continue beyond one hundred posts without dropping the loaded baseline", async () => {
  const known = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 4; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the next request uses the prior page's cursor.
    const result = await readAuthorFeedWindow(
      (position) => {
        expect(position).toBe(page ? String(page) : null);
        return Promise.resolve({
          cursor: String(page + 1),
          items: Array.from({ length: 40 }, (_, index) =>
            post(`${page}-${index}`)
          ),
        });
      },
      cursor,
      known
    );
    expect(result.items).toHaveLength(40);
    for (const item of result.items) {
      expect(known.has(item.id)).toBe(false);
      known.add(item.id);
    }
    ({ cursor } = result);
  }
  expect(known.size).toBe(160);
});

test("a repeated author cursor stops a loop without discarding usable posts", async () => {
  let reads = 0;
  const page = await readAuthorFeedWindow(
    () => {
      reads += 1;
      return Promise.resolve({ cursor: "same", items: [post("one")] });
    },
    "same",
    new Set()
  );
  expect(reads).toBe(1);
  expect(page.cursor).toBeNull();
  expect(page.items).toHaveLength(1);
});
