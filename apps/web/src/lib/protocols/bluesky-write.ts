import { createHash } from "node:crypto";

import type { ExternalPost } from "@asm/protocols/contracts";
import {
  asAtUriString,
  currentDatetimeString,
  isTidString,
  LexError,
} from "@atproto/lex";
import type { Client } from "@atproto/lex";
import { app } from "@bsky/sdk/lexicons";

export type BlueskyWrite =
  | { action: "amplify" | "bookmark"; active: boolean; uri: string }
  | { action: "comment"; content: string; requestId: string; uri: string };

// The same authenticated action always addresses the same repository record, even after a lost response.
export function blueskyInteractionKey(
  did: string,
  uri: string,
  action: string
) {
  let value =
    createHash("sha256")
      .update(JSON.stringify(["asm", did, uri, action]))
      .digest()
      .readBigUInt64BE() %
    2n ** 63n;
  const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
  let key = "";
  for (let index = 0; index < 13; index += 1) {
    key = alphabet[Number(value % 32n)] + key;
    value /= 32n;
  }
  if (!isTidString(key)) {
    throw new Error("Invalid interaction record key");
  }
  return key;
}

export async function writeBlueskyInteraction(
  client: Client,
  input: BlueskyWrite,
  post?: ExternalPost
) {
  const signal = AbortSignal.timeout(12_000);
  const uri = asAtUriString(input.uri);
  if (input.action === "bookmark") {
    const options = {
      service: "did:web:api.bsky.app#bsky_appview" as const,
      signal,
    };
    if (input.active) {
      if (!post) {
        throw new Error("The source post is unavailable");
      }
      await client.call(
        app.bsky.bookmark.createBookmark,
        { cid: post.revision, uri },
        options
      );
    } else {
      await client.call(app.bsky.bookmark.deleteBookmark, { uri }, options);
    }
    return;
  }
  const rkey = blueskyInteractionKey(
    client.did ?? "",
    input.uri,
    input.action === "comment" ? `comment:${input.requestId}` : "repost"
  );
  const find = async () => {
    try {
      return input.action === "comment"
        ? await client.get(app.bsky.feed.post, { rkey, signal })
        : await client.get(app.bsky.feed.repost, { rkey, signal });
    } catch (error) {
      if (error instanceof LexError && error.error === "RecordNotFound") {
        return;
      }
      throw error;
    }
  };
  const existing = await find();
  if (existing) {
    const target =
      existing.value.$type === "app.bsky.feed.repost"
        ? existing.value.subject.uri
        : existing.value.reply?.parent.uri;
    if (target !== input.uri) {
      throw new Error("Interaction record conflict");
    }
    if (input.action === "amplify" && !input.active) {
      await client.delete(app.bsky.feed.repost, {
        rkey,
        signal,
        swapRecord: existing.cid,
      });
    }
    return;
  }
  if (input.action === "amplify" && !input.active) {
    return;
  }
  if (!post) {
    throw new Error("The source post is unavailable");
  }
  const subject = { cid: post.revision, uri };
  let root = subject;
  if (
    input.action === "comment" &&
    post.replyRoot &&
    post.replyRoot !== input.uri
  ) {
    const rootPost = await client.call(
      app.bsky.feed.getPosts,
      { uris: [asAtUriString(post.replyRoot)] },
      { service: "did:web:api.bsky.app#bsky_appview", signal }
    );
    const record = rootPost.posts.find((entry) => entry.uri === post.replyRoot);
    if (!record) {
      throw new Error("The source thread is unavailable");
    }
    root = { cid: record.cid, uri: record.uri };
  }
  try {
    await (input.action === "comment"
      ? client.create(
          app.bsky.feed.post,
          {
            createdAt: currentDatetimeString(),
            reply: { parent: subject, root },
            text: input.content,
          },
          { rkey, signal }
        )
      : client.create(
          app.bsky.feed.repost,
          { createdAt: currentDatetimeString(), subject },
          { rkey, signal }
        ));
  } catch (error) {
    // A simultaneous retry may have committed this exact record first.
    if (!(await find())) {
      throw error;
    }
  }
}
