import { readNetworkPreferences } from "@asm/db";
import { ProtocolError } from "@asm/protocols/contracts";
import { connection } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { cachedSpotlightSearch } from "@/lib/search/cached-search";
import { guestSearchBudget } from "@/lib/search/guest-budget";

export async function GET(request: Request) {
  // Public search popup; no account needed. Search results must never be baked
  // into a prerendered response, and the claim also keeps the Prisma reads out
  // of the prerender: Prisma 8 stamps each query with a crypto.randomUUID()
  // plan id, and Cache Components fails a prerender that touches an uncached
  // value.
  await connection();

  const url = new URL(request.url);
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  const parsed = z
    .object({
      kind: z.enum(["all", "user", "post", "community"]).default("all"),
      limit: z.coerce.number().int().min(1).max(20).default(6),
      q: z.string().trim().max(80).default(""),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid search" }, { headers, status: 400 });
  }
  const { q, kind, limit } = parsed.data;

  if (q.length < 2) {
    return Response.json(
      { communities: [], posts: [], users: [] },
      { headers }
    );
  }

  const budget = await guestSearchBudget(request);
  if (budget.response) {
    return budget.response;
  }
  try {
    const session = await getSessionFromApi();
    const settings = session?.user?.id
      ? await readNetworkPreferences(session.user.id)
      : null;
    const excludeExplicit = !settings?.preferences.showExplicitContent;

    return Response.json(
      await cachedSpotlightSearch(
        q,
        kind,
        limit,
        request.signal,
        excludeExplicit
      ),
      { headers: budget.headers }
    );
  } catch (error) {
    const busy = error instanceof ProtocolError && error.code === "capacity";
    return Response.json(
      {
        error: busy
          ? "Search is busy. Try again shortly."
          : "Search is temporarily unavailable.",
      },
      {
        headers: new Headers([...budget.headers, ["retry-after", "1"]]),
        status: 503,
      }
    );
  }
}
