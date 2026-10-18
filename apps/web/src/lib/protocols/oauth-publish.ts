import type { ExternalPost } from "@asm/protocols/contracts";
import { asAtUriString } from "@atproto/lex";
import { like, post as publishPost } from "@bsky/sdk";

import { blueskyOAuthLexClient } from "./oauth";

export async function publishBlueskyInteraction(
  userId: string,
  did: string,
  post: ExternalPost,
  content?: string
) {
  const client = await blueskyOAuthLexClient(userId, did);
  const subject = { cid: post.revision, uri: asAtUriString(post.id) };
  await (content
    ? publishPost(
        client,
        { reply: { parent: subject, root: subject }, text: content },
        {}
      )
    : like(client, subject, {}));
}
