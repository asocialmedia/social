import { asAtUriString, currentDatetimeString, LexError } from "@atproto/lex";
import type { Client } from "@atproto/lex";
import { app } from "@bsky/sdk/lexicons";

import { blueskyInteractionKey } from "./bluesky-write";

export async function blueskyLike(
  client: Client,
  uri: string,
  active?: boolean
) {
  if (!client.did) {
    throw new Error("Bluesky account is unavailable");
  }
  const signal = AbortSignal.timeout(12_000);
  const target = asAtUriString(uri);
  const { posts } = await client.call(
    app.bsky.feed.getPosts,
    { uris: [target] },
    { service: "did:web:api.bsky.app#bsky_appview", signal }
  );
  const post = posts.find((entry) => entry.uri === uri);
  if (!post) {
    throw new Error("The source post is unavailable");
  }
  const rkey = blueskyInteractionKey(client.did, uri, "like");
  const readRecord = async (key: string) => {
    try {
      const record = await client.get(app.bsky.feed.like, {
        rkey: key,
        signal,
      });
      if (record.value.subject.uri !== uri) {
        throw new Error("Like record conflict");
      }
      return record;
    } catch (error) {
      if (error instanceof LexError && error.error === "RecordNotFound") {
        return;
      }
      throw error;
    }
  };
  const own = await readRecord(rkey);
  const wasLiked = Boolean(own || post.viewer?.like);
  if (active === undefined) {
    return { liked: wasLiked, likes: post.likeCount ?? null };
  }
  if (active && !wasLiked) {
    try {
      await client.create(
        app.bsky.feed.like,
        {
          createdAt: currentDatetimeString(),
          subject: { cid: post.cid, uri: target },
        },
        { rkey, signal }
      );
    } catch (error) {
      // A retry after a lost response must resolve the same record.
      if (!(await readRecord(rkey))) {
        throw error;
      }
    }
  }
  if (!active) {
    const prefix = `at://${client.did}/app.bsky.feed.like/`;
    const viewerKey = post.viewer?.like?.startsWith(prefix)
      ? post.viewer.like.slice(prefix.length)
      : undefined;
    if (viewerKey?.includes("/")) {
      throw new Error("Invalid viewer like record");
    }
    const keys = [...new Set([rkey, ...(viewerKey ? [viewerKey] : [])])];
    for (const key of keys) {
      // oxlint-disable-next-line no-await-in-loop -- compare-and-swap deletion verifies each owned record first.
      const record = key === rkey ? own : await readRecord(key);
      if (record) {
        // oxlint-disable-next-line no-await-in-loop -- a retry safely observes RecordNotFound instead of duplicating work.
        await client.delete(app.bsky.feed.like, {
          rkey: key,
          signal,
          swapRecord: record.cid,
        });
      }
    }
  }
  let likes = post.likeCount ?? null;
  if (likes !== null && active !== wasLiked) {
    likes = Math.max(0, likes + (active ? 1 : -1));
  }
  return { liked: active, likes };
}
