import {
  externalPostSchema,
  externalCommentPageSchema,
  externalStateSchema,
} from "@asm/protocols/discovery";
import type { ExternalMutation } from "@asm/protocols/discovery";
import { z } from "zod";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";

const detailSchema = z.object({
  comments: externalCommentPageSchema,
  post: externalPostSchema.nullable(),
});
export const externalLibrarySchema = z.object({
  cursor: z
    .object({ externalPostId: z.string(), updatedAt: z.string() })
    .nullable(),
  items: z.array(
    z.object({ post: externalPostSchema.nullable(), uri: z.string() })
  ),
});
export async function externalRequest(
  query: URLSearchParams,
  init?: RequestInit
) {
  const cookie = await authClient.getCookie();
  const response = await fetch(
    `${getApiBaseUrl()}/api/protocols/bluesky/interactions?${query}`,
    {
      ...init,
      headers: {
        "x-asm-client": "mobile",
        ...(cookie ? { cookie } : {}),
        ...(init?.method === "POST"
          ? { "content-type": "application/json" }
          : {}),
      },
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok) {
    let message = "Couldn't save. Please try again.";
    if (response.status === 429) {
      message = "Please wait a moment before trying again.";
    }
    if (response.status === 410) {
      message = "The source post is unavailable.";
    }
    throw new Error(message);
  }
  return (await response.json()) as unknown;
}
export async function mutateExternal(input: ExternalMutation) {
  return externalStateSchema.parse(
    await externalRequest(new URLSearchParams(), {
      body: JSON.stringify(input),
      method: "POST",
    })
  );
}
export async function readExternal(
  uri: string,
  cursor?: { createdAt: string; id: string },
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ uri });
  if (cursor) {
    query.set("cursor", JSON.stringify(cursor));
  }
  return detailSchema.parse(await externalRequest(query, { signal }));
}
