import {
  communityProxyUrl,
  prisma,
  promoteCommunityDerivative,
  purgeSupersededCommunityMedia,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-media-link" });

export type CommunityMediaKind = "avatar" | "banner";

interface LinkResult {
  error: string;
  status: number;
}

// Links a READY media row to a community's avatar or banner. Only the owner or
// a moderator may set community imagery, and only rows the caller uploaded.
// Mirrors the user avatar/banner link routes so the pipeline lifecycle (purge,
// promote) is identical for both surfaces.
export async function linkCommunityMedia(
  slug: string,
  kind: CommunityMediaKind,
  request: Request
): Promise<LinkResult | { key: string; url: string }> {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return { error: "Unauthorized", status: 401 };
  }

  let payload: { mediaId?: unknown };
  try {
    payload = (await request.json()) as { mediaId?: unknown };
  } catch {
    return { error: "Invalid JSON body", status: 400 };
  }
  if (
    !payload.mediaId ||
    typeof payload.mediaId !== "string" ||
    payload.mediaId.length > 64
  ) {
    return { error: "mediaId is required", status: 400 };
  }

  const community = await prisma.community.findUnique({
    select: { id: true, ownerId: true },
    where: { slug: slug.trim().toLowerCase() },
  });
  if (!community) {
    return { error: "Community not found", status: 404 };
  }

  const isOwner = community.ownerId === user.id;
  if (!isOwner) {
    const membership = await prisma.communityMember.findUnique({
      select: { role: true, status: true },
      where: {
        communityId_userId: { communityId: community.id, userId: user.id },
      },
    });
    const canModerate =
      membership?.status === "ACTIVE" && membership.role === "MODERATOR";
    if (!canModerate) {
      return {
        error: "Only moderators can change community imagery",
        status: 403,
      };
    }
  }

  const media = await prisma.media.findUnique({
    select: {
      id: true,
      key: true,
      publishedKey: true,
      status: true,
      type: true,
      userId: true,
    },
    where: { id: payload.mediaId },
  });
  if (!media || media.userId !== user.id) {
    return { error: "Media not found", status: 404 };
  }
  if (media.status !== "READY") {
    return { error: "Upload is not ready yet", status: 409 };
  }
  if (media.type !== "IMAGE") {
    return { error: "Only images can be used here", status: 415 };
  }

  const servingKey = media.publishedKey ?? media.key;
  const url = communityProxyUrl(kind, community.id, servingKey);

  const current = await prisma.community.findUnique({
    select: { avatarMediaId: true, bannerMediaId: true },
    where: { id: community.id },
  });
  const previousMediaId =
    kind === "avatar" ? current?.avatarMediaId : current?.bannerMediaId;

  // One update call, branching only the column set: the avatar and banner
  // surfaces share the same shape otherwise.
  await prisma.community.update({
    data:
      kind === "avatar"
        ? { avatarKey: servingKey, avatarMediaId: media.id, avatarUrl: url }
        : { bannerKey: servingKey, bannerMediaId: media.id, bannerUrl: url },
    where: { id: community.id },
  });

  // Reap the replaced pipeline upload (best-effort) and cover the promotion
  // race: derivatives may have committed before this link landed.
  if (previousMediaId && previousMediaId !== media.id) {
    try {
      await purgeSupersededCommunityMedia(previousMediaId, community.id);
    } catch (error) {
      logger.warn(
        { error: String(error), mediaId: previousMediaId },
        "failed to purge superseded community media"
      );
    }
  }
  try {
    await promoteCommunityDerivative(media.id, kind);
  } catch (error) {
    logger.warn(
      { error: String(error), mediaId: media.id },
      "failed to promote community derivative"
    );
  }

  logger.info(
    { communityId: community.id, kind, mediaId: media.id, userId: user.id },
    "community media linked"
  );
  return { key: servingKey, url };
}
