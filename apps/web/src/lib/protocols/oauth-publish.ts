import type { ExternalPost } from "@asm/protocols/contracts";

import { writeBlueskyInteraction } from "./bluesky-write";
import type { BlueskyWrite } from "./bluesky-write";
import { blueskyOAuthLexClient } from "./oauth";

export async function publishBlueskyInteraction(
  userId: string,
  did: string,
  input: BlueskyWrite,
  post?: ExternalPost
) {
  const client = await blueskyOAuthLexClient(userId, did);
  await writeBlueskyInteraction(client, input, post);
}
