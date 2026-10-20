// The client transport must return a promise even when fixture responses are immediate.
// oxlint-disable require-await
import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { Client, isTidString } from "@atproto/lex";

import {
  blueskyInteractionKey,
  writeBlueskyInteraction,
} from "./bluesky-write";

const did = "did:plc:example";
const uri = `at://${did}/app.bsky.feed.post/3my5g6mviy22p`;
const cid = "bafyreigfmyw5idmtjq6pcakaiuli22lydfdx5siywhxc2rwjdq3siagmj4";
const post: ExternalPost = {
  author: {
    displayName: "Example",
    handle: "example.test",
    id: did,
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/example.test",
  },
  createdAt: "2026-10-18T00:00:00.000Z",
  id: uri,
  labels: [],
  languages: [],
  media: [],
  revision: cid,
  segments: [{ text: "Clip" }],
  source: "bluesky",
  text: "Clip",
  upstreamCounts: {},
  url: "https://bsky.app/profile/example.test/post/3my5g6mviy22p",
};

function fixture() {
  const records = new Map<string, unknown>();
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  let loseCreateResponse = false;
  const client = new Client({
    did,
    fetchHandler: async (path, init) => {
      const url = new URL(path, "https://example.test");
      const method = url.pathname.split("/").at(-1) ?? "";
      if (method === "com.atproto.repo.getRecord") {
        const key = `${url.searchParams.get("collection")}/${url.searchParams.get("rkey")}`;
        const value = records.get(key);
        return value
          ? Response.json({ cid, uri: `at://${did}/${key}`, value })
          : Response.json(
              { error: "RecordNotFound", message: "Missing" },
              { status: 400 }
            );
      }
      const body: Record<string, unknown> =
        typeof init.body === "string" ? JSON.parse(init.body) : {};
      writes.push({ body, method });
      const key = `${body.collection}/${body.rkey}`;
      if (method === "com.atproto.repo.createRecord") {
        records.set(key, body.record);
        if (loseCreateResponse) {
          throw new Error("Lost response");
        }
        return Response.json({ cid, uri: `at://${did}/${key}` });
      }
      if (method === "com.atproto.repo.deleteRecord") {
        records.delete(key);
      }
      return Response.json({});
    },
  });
  return {
    client,
    loseResponse: () => {
      loseCreateResponse = true;
    },
    records,
    writes,
  };
}

test("linked amplify creates a repost once across retries, then safely removes it", async () => {
  const { client, records, writes } = fixture();
  await writeBlueskyInteraction(
    client,
    { action: "amplify", active: true, uri },
    post
  );
  await writeBlueskyInteraction(
    client,
    { action: "amplify", active: true, uri },
    post
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body.collection).toBe("app.bsky.feed.repost");
  expect(writes[0]?.body.record).toMatchObject({ subject: { cid, uri } });
  await writeBlueskyInteraction(client, {
    action: "amplify",
    active: false,
    uri,
  });
  expect(writes[1]?.body.swapRecord).toBe(cid);
  expect(records.size).toBe(0);
  await writeBlueskyInteraction(client, {
    action: "amplify",
    active: false,
    uri,
  });
  expect(writes).toHaveLength(2);
});

test("a committed repost survives a lost response without duplicating the action", async () => {
  const { client, loseResponse, writes } = fixture();
  loseResponse();
  await writeBlueskyInteraction(
    client,
    { action: "amplify", active: true, uri },
    post
  );
  await writeBlueskyInteraction(
    client,
    { action: "amplify", active: true, uri },
    post
  );
  expect(writes).toHaveLength(1);
});

test("linked bookmarks call AppView create and delete without creating repost records", async () => {
  const { client, writes } = fixture();
  await writeBlueskyInteraction(
    client,
    { action: "bookmark", active: true, uri },
    post
  );
  await writeBlueskyInteraction(client, {
    action: "bookmark",
    active: false,
    uri,
  });
  expect(writes.map((write) => write.method)).toEqual([
    "app.bsky.bookmark.createBookmark",
    "app.bsky.bookmark.deleteBookmark",
  ]);
  expect(writes[0]?.body).toEqual({ cid, uri });
});

test("comment retries use the same thread record and distinguish separate requests", async () => {
  const { client, writes } = fixture();
  const input = {
    action: "comment" as const,
    content: "Nice clip",
    requestId: "request-one",
    uri,
  };
  await writeBlueskyInteraction(client, input, post);
  await writeBlueskyInteraction(client, input, post);
  await writeBlueskyInteraction(
    client,
    { ...input, requestId: "request-two" },
    post
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]?.body.record).toMatchObject({
    reply: { parent: { cid, uri }, root: { cid, uri } },
    text: "Nice clip",
  });
  expect(writes[0]?.body.rkey).not.toBe(writes[1]?.body.rkey);
});

test("interaction keys are valid TIDs scoped to account, post, and action", () => {
  const key = blueskyInteractionKey(did, uri, "repost");
  expect(isTidString(key)).toBe(true);
  expect(blueskyInteractionKey(did, uri, "repost")).toBe(key);
  expect(blueskyInteractionKey("did:plc:other", uri, "repost")).not.toBe(key);
  expect(blueskyInteractionKey(did, `${uri}x`, "repost")).not.toBe(key);
  expect(blueskyInteractionKey(did, uri, "comment:request")).not.toBe(key);
});
