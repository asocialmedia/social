import { Client } from "@atproto/lex";
import { com } from "@bsky/sdk/lexicons";
import { z } from "zod";

import { readJsonBounded } from "../transport";
import { didSchema } from "./schemas";

const statusSchema = z.object({
  active: z.boolean(),
  did: didSchema,
  status: z
    .enum([
      "deleted",
      "deactivated",
      "takendown",
      "suspended",
      "desynchronized",
      "throttled",
    ])
    .optional(),
});

// Query a fixed trusted relay, never a user-supplied PDS URL.
// RepoNotFound, HTTP errors, and unknown statuses are not proof of deletion.
export async function readBlueskyAccountStatus(
  did: string,
  signal: AbortSignal,
  request: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response> = fetch
) {
  const actor = didSchema.parse(did);
  try {
    const client = new Client(
      async (path, init) => {
        const response = await request(new URL(path, "https://bsky.network"), {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        const data = await readJsonBounded(response, 16 * 1024, signal);
        return Response.json(data, {
          headers: { "content-type": "application/json" },
          status: response.status,
        });
      },
      { validateRequest: true, validateResponse: true }
    );
    const result = statusSchema.safeParse(
      await client.call(
        com.atproto.sync.getRepoStatus,
        { did: actor },
        { maxRetries: 0 }
      )
    );
    if (!result.success || result.data.did !== actor) {
      return "unknown" as const;
    }
    return result.data.active
      ? ("active" as const)
      : (result.data.status ?? ("unknown" as const));
  } catch {
    return "unknown" as const;
  }
}
