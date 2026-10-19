import {
  consumeRateLimit,
  clearNetworkActivity,
  getNetworkSettings,
  NetworkPreferenceConflictError,
  saveNetworkPreferences,
} from "@asm/db";
import { networkPreferencesUpdateSchema } from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { invalidateDiscoverySuggestions } from "@/lib/recommendations/suggestion-version";

const headers = { "cache-control": "private, no-store", vary: "Cookie" };

export async function DELETE(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { headers, status: 401 });
  }
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(request.url).origin)
  ) {
    return Response.json({ error: "Invalid origin" }, { headers, status: 403 });
  }
  const rate = await consumeRateLimit({
    bucket: "network-preferences",
    identifier: session.user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Try again shortly" },
      { headers, status: 429 }
    );
  }
  const raw = await request.text();
  if (raw.length > 1024) {
    return Response.json(
      { error: "Request too large" },
      { headers, status: 413 }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { headers, status: 400 });
  }
  const parsed = z
    .object({
      profileId: z.string().max(64),
      revision: z.number().int().nonnegative(),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid activity reset" },
      { headers, status: 400 }
    );
  }
  try {
    await clearNetworkActivity(
      session.user.id,
      parsed.data.profileId,
      parsed.data.revision
    );
    return Response.json(await getNetworkSettings(session.user.id), {
      headers,
    });
  } catch (error) {
    if (error instanceof NetworkPreferenceConflictError) {
      return Response.json({ error: error.message }, { headers, status: 409 });
    }
    throw error;
  }
}

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { headers, status: 401 });
  }
  return Response.json(await getNetworkSettings(session.user.id), { headers });
}

export async function PUT(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { headers, status: 401 });
  }
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(request.url).origin)
  ) {
    return Response.json({ error: "Invalid origin" }, { headers, status: 403 });
  }
  const rate = await consumeRateLimit({
    bucket: "network-preferences",
    identifier: session.user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Try again shortly" },
      { headers, status: 429 }
    );
  }
  const raw = await request.text();
  if (raw.length > 32_768) {
    return Response.json(
      { error: "Settings are too large" },
      { headers, status: 413 }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { headers, status: 400 });
  }
  const parsed = networkPreferencesUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid network preferences" },
      { headers, status: 400 }
    );
  }
  try {
    await saveNetworkPreferences(
      session.user.id,
      parsed.data.preferences,
      parsed.data.revision
    );
    // A policy change (interest, avoided topic, explicit content) must not keep
    // serving a suggestion snapshot built under the old preferences.
    await invalidateDiscoverySuggestions(session.user.id).catch(() => {
      // The save already committed; a cache miss only costs one rebuild.
    });
    return Response.json(await getNetworkSettings(session.user.id), {
      headers,
    });
  } catch (error) {
    if (error instanceof NetworkPreferenceConflictError) {
      return Response.json({ error: error.message }, { headers, status: 409 });
    }
    throw error;
  }
}
