import { prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";
import { blueskyMediaIsExplicit } from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { explicitContentEnabled } from "@/lib/posts/explicit-content-enabled";

export function profileDeclaresExplicitContent(profile: {
  id?: string;
  bio?: unknown;
  username?: unknown;
  displayName?: unknown;
}) {
  return blueskyMediaIsExplicit({
    text: [profile.bio, profile.username, profile.displayName]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  });
}

export async function userFollowerCounts() {
  const rows = await prisma.orm.public.Follows.groupBy("followingId").aggregate(
    (aggregate) => ({ total: aggregate.count() })
  );
  return new Map(rows.map((row) => [row.followingId, row.total]));
}

// Recheck fresh moderation state even when a suggestion came from an older cache.
export async function safeUserDiscoveryResponse(response: Response) {
  if (!response.ok) {
    return response;
  }
  const users = z
    .array(z.looseObject({ id: z.string() }))
    .parse(await response.json());
  const session = await getSessionFromApi();
  const includeExplicit = await explicitContentEnabled(session?.user.id ?? "");
  const current = users.length
    ? await prisma.orm.public.Users.where((candidate) =>
        candidate.id.in(users.map((user) => user.id))
      )
        .select(
          "id",
          "banned",
          "bio",
          "username",
          "displayName",
          "avatarMediaId",
          "bannerMediaId"
        )
        .all()
    : [];
  const mediaIds = current
    .flatMap((user) => [user.avatarMediaId, user.bannerMediaId])
    .filter((id): id is string => Boolean(id));
  const media =
    !includeExplicit && mediaIds.length
      ? await prisma.orm.public.PostMedia.where((item) => item.id.in(mediaIds))
          .select("id", "safety")
          .all()
      : [];
  const explicitMedia = new Set(
    media
      .filter(
        (item) =>
          typeof item.safety === "object" &&
          item.safety !== null &&
          "explicit" in item.safety &&
          item.safety.explicit === true
      )
      .map((item) => item.id)
  );
  const allowed = new Set(
    current
      .filter(
        (user) =>
          !user.banned &&
          user.id !== SYSTEM_MODERATION_USER_ID &&
          (includeExplicit ||
            (!profileDeclaresExplicitContent(user) &&
              !explicitMedia.has(user.avatarMediaId ?? "") &&
              !explicitMedia.has(user.bannerMediaId ?? "")))
      )
      .map((user) => user.id)
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie, Authorization");
  return Response.json(
    users.filter(
      (user) =>
        allowed.has(user.id) &&
        (includeExplicit || !profileDeclaresExplicitContent(user))
    ),
    { headers: response.headers }
  );
}
