// Async fixtures exercise the official SDK transport.
// oxlint-disable require-await
import { expect, test } from "bun:test";

import { Client } from "@atproto/lex";

import { blueskyLike } from "./bluesky-like";

const did = "did:plc:example";
const uri = `at://${did}/app.bsky.feed.post/3my5g6mviy22p`;
const cid = "bafyreigfmyw5idmtjq6pcakaiuli22lydfdx5siywhxc2rwjdq3siagmj4";

function fixture() {
  const records = new Map<string, unknown>();
  const writes: { collection: string; record?: unknown; rkey: string }[] = [];
  let viewerLike: string | undefined;
  let loseResponse = false;
  const client = new Client({
    did,
    fetchHandler: async (path, init) => {
      const url = new URL(path, "https://example.test");
      const method = url.pathname.split("/").at(-1);
      if (method === "app.bsky.feed.getPosts") {
        return Response.json({
          posts: [
            {
              author: { did, handle: "example.test" },
              cid,
              indexedAt: "2026-10-18T00:00:00Z",
              likeCount: 10,
              record: {
                $type: "app.bsky.feed.post",
                createdAt: "2026-10-18T00:00:00Z",
                text: "Example",
              },
              uri,
              viewer: viewerLike ? { like: viewerLike } : {},
            },
          ],
        });
      }
      if (method === "com.atproto.repo.getRecord") {
        const key = url.searchParams.get("rkey") ?? "";
        const value = records.get(key);
        return value
          ? Response.json({
              cid,
              uri: `at://${did}/app.bsky.feed.like/${key}`,
              value,
            })
          : Response.json({ error: "RecordNotFound" }, { status: 400 });
      }
      const body: { collection: string; record?: unknown; rkey: string } =
        JSON.parse(String(init.body));
      writes.push(body);
      if (method === "com.atproto.repo.createRecord") {
        records.set(body.rkey, body.record);
        if (loseResponse) {
          throw new Error("Lost response");
        }
        return Response.json({
          cid,
          uri: `at://${did}/app.bsky.feed.like/${body.rkey}`,
        });
      }
      if (method === "com.atproto.repo.deleteRecord") {
        records.delete(body.rkey);
      }
      return Response.json({});
    },
  });
  return {
    client,
    existing: (key: string, target = uri) => {
      viewerLike = `at://${did}/app.bsky.feed.like/${key}`;
      records.set(key, {
        $type: "app.bsky.feed.like",
        createdAt: "2026-10-18T00:00:00Z",
        subject: { cid, uri: target },
      });
    },
    lose: () => {
      loseResponse = true;
    },
    records,
    writes,
  };
}

test("likes create a real like with a verified strong reference and retries cannot duplicate it", async () => {
  const { client, records, writes, lose } = fixture();
  expect(await blueskyLike(client, uri)).toEqual({ liked: false, likes: 10 });
  lose();
  expect(await blueskyLike(client, uri, true)).toEqual({
    liked: true,
    likes: 11,
  });
  await blueskyLike(client, uri, true);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.collection).toBe("app.bsky.feed.like");
  expect(writes[0]?.record).toMatchObject({ subject: { cid, uri } });
  expect(records.size).toBe(1);
  await blueskyLike(client, uri, false);
  await blueskyLike(client, uri, false);
  expect(records.size).toBe(0);
  expect(writes).toHaveLength(2);
});

test("unlike also removes an existing like made in Bluesky while refusing a mismatched record", async () => {
  const { client, records, existing } = fixture();
  existing("3my5g6mviy22q");
  expect(await blueskyLike(client, uri, true)).toEqual({
    liked: true,
    likes: 10,
  });
  expect(records.size).toBe(1);
  await blueskyLike(client, uri, false);
  expect(records.size).toBe(0);
  existing("3my5g6mviy22q", uri.replace("3my5g6mviy22p", "different"));
  await expect(blueskyLike(client, uri, false)).rejects.toThrow(
    "Like record conflict"
  );
  expect(records.size).toBe(1);
});
