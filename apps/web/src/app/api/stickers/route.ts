import { and, or, prisma, rawQuery, toPrismaDateTime } from "@asm/db";
import {
  STICKER_LIBRARY_MAX_BYTES,
  STICKER_LIBRARY_MAX_ITEMS,
} from "@asm/media";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const createSchema = z.object({
  mediaId: z.string().min(1).max(128),
  name: z.string().trim().max(128).optional().default(""),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaUrls(mediaId: string) {
  return {
    thumbnailUrl: `/api/media/${encodeURIComponent(mediaId)}/v/sticker-thumb.webp`,
    url: `/api/media/${encodeURIComponent(mediaId)}/v/sticker-full.webp`,
  };
}

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const collection = url.searchParams.get("collection") ?? "mine";
  if (!["mine", "recent", "favorites"].includes(collection)) {
    return NextResponse.json(
      { error: "Choose a sticker collection" },
      { status: 400 }
    );
  }
  const cursor = url.searchParams.get("cursor");
  const take = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || 40, 1),
    collection === "recent" ? 30 : 40
  );
  let cursorAt: Date | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf-8")
      ) as {
        at?: unknown;
        id?: unknown;
      };
      if (typeof decoded.at !== "string" || typeof decoded.id !== "string") {
        throw new TypeError("Invalid cursor");
      }
      cursorAt = new Date(decoded.at);
      cursorId = decoded.id;
      if (!Number.isFinite(cursorAt.getTime())) {
        throw new TypeError("Invalid cursor");
      }
    } catch {
      return NextResponse.json(
        { error: "Sticker cursor is invalid" },
        { status: 400 }
      );
    }
  }

  let stickerQuery = prisma.orm.public.UserStickers.where({ userId: user.id });
  if (collection === "favorites") {
    stickerQuery = stickerQuery.where({ favorite: true });
  }
  if (collection === "recent") {
    stickerQuery = stickerQuery.where((sticker) =>
      sticker.lastUsedAt.isNotNull()
    );
  }
  if (cursorAt && cursorId) {
    stickerQuery = stickerQuery.where((sticker) =>
      or(
        collection === "recent"
          ? sticker.lastUsedAt.lt(toPrismaDateTime(cursorAt))
          : sticker.createdAt.lt(toPrismaDateTime(cursorAt)),
        and(
          collection === "recent"
            ? sticker.lastUsedAt.eq(toPrismaDateTime(cursorAt))
            : sticker.createdAt.eq(toPrismaDateTime(cursorAt)),
          sticker.id.lt(cursorId)
        )
      )
    );
  }
  const stickers = await stickerQuery
    .orderBy(
      collection === "recent"
        ? [
            (sticker) => sticker.lastUsedAt.desc(),
            (sticker) => sticker.id.desc(),
          ]
        : [
            (sticker) => sticker.createdAt.desc(),
            (sticker) => sticker.id.desc(),
          ]
    )
    .limit(take + 1)
    .all();
  const hasMore = stickers.length > take;
  const page = stickers.slice(0, take);
  const mediaIds = page.map((sticker) => sticker.mediaId);
  const derivatives = mediaIds.length
    ? await prisma.orm.public.PostMediaDerivatives.where((derivative) =>
        and(derivative.mediaId.in(mediaIds), derivative.kind.eq("sticker"))
      ).all()
    : [];
  const derivativeByKey = new Map(
    derivatives.map((derivative) => [
      `${derivative.mediaId}:${derivative.variant}`,
      derivative,
    ])
  );
  const items = page.flatMap((sticker) => {
    const full = derivativeByKey.get(`${sticker.mediaId}:full`);
    const thumbnail = derivativeByKey.get(`${sticker.mediaId}:thumb`);
    if (!full || !thumbnail) {
      return [];
    }
    return [
      {
        animated: sticker.animated,
        byteSize: sticker.byteSize,
        favorite: sticker.favorite,
        height: full.height ?? 0,
        id: sticker.id,
        mediaId: sticker.mediaId,
        name: sticker.name,
        thumbnailUrl: mediaUrls(sticker.mediaId).thumbnailUrl,
        url: mediaUrls(sticker.mediaId).url,
        width: full.width ?? 0,
      },
    ];
  });
  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? Buffer.from(
          JSON.stringify({
            at: (collection === "recent"
              ? last.lastUsedAt
              : last.createdAt
            )?.toString(),
            id: last.id,
          })
        ).toString("base64url")
      : null;
  return NextResponse.json(
    { items, nextCursor },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success || [...(parsed.data?.name ?? "")].length > 64) {
    return NextResponse.json(
      { error: "Sticker details are invalid" },
      { status: 400 }
    );
  }

  const media = await prisma.orm.public.PostMedia.select(
    "commentId",
    "id",
    "messageConversationId",
    "postId",
    "status",
    "stickerSource",
    "techMetadata",
    "userId"
  )
    .where({ id: parsed.data.mediaId })
    .first();
  if (
    !media ||
    media.userId !== user.id ||
    !media.stickerSource ||
    media.status !== "READY" ||
    media.postId ||
    media.commentId ||
    media.messageConversationId
  ) {
    return NextResponse.json(
      { error: "Sticker upload is not ready" },
      { status: 409 }
    );
  }
  const metadata = isRecord(media.techMetadata) ? media.techMetadata : {};
  const stickerMetadata = isRecord(metadata.sticker) ? metadata.sticker : {};
  const animated = stickerMetadata.animated === true;
  if (
    stickerMetadata.version !== 1 ||
    !Number.isSafeInteger(stickerMetadata.frameCount)
  ) {
    return NextResponse.json(
      { error: "Sticker conversion is not ready" },
      { status: 409 }
    );
  }
  const derivatives = await prisma.orm.public.PostMediaDerivatives.where(
    (derivative) =>
      and(
        derivative.mediaId.eq(media.id),
        derivative.kind.eq("sticker"),
        derivative.variant.in(["full", "thumb"])
      )
  ).all();
  const full = derivatives.find((derivative) => derivative.variant === "full");
  const thumbnail = derivatives.find(
    (derivative) => derivative.variant === "thumb"
  );
  if (
    !full ||
    !thumbnail ||
    full.mimeType !== "image/webp" ||
    thumbnail.mimeType !== "image/webp" ||
    !full.sizeBytes ||
    !thumbnail.sizeBytes
  ) {
    return NextResponse.json(
      { error: "Sticker conversion is not ready" },
      { status: 409 }
    );
  }
  const byteSize = full.sizeBytes + thumbnail.sizeBytes;
  if (byteSize > STICKER_LIBRARY_MAX_BYTES) {
    return NextResponse.json(
      { error: "Sticker exceeds your library size limit" },
      { status: 413 }
    );
  }

  try {
    const saved = await prisma.transaction(async (tx) => {
      // Prisma rc.14 has no typed row-lock API; serialize quota checks with Prisma's raw lane.
      const lock = await rawQuery<{ id: string }>(
        `SELECT id FROM public.users WHERE id = $1 FOR UPDATE`,
        [user.id],
        { id: "pg/text@1" },
        tx
      );
      if (lock.rows.length !== 1) {
        throw new Error("Sticker owner is unavailable");
      }
      const existing = await tx.orm.public.UserStickers.where({
        mediaId: media.id,
      }).first();
      if (existing) {
        if (existing.userId !== user.id) {
          throw new Error("Sticker upload is already in use");
        }
        return existing;
      }
      const current = await tx.orm.public.UserStickers.where({
        userId: user.id,
      }).aggregate((aggregate) => ({
        count: aggregate.count(),
        totalBytes: aggregate.sum("byteSize"),
      }));
      if (current.count >= STICKER_LIBRARY_MAX_ITEMS) {
        throw new Error("Your sticker library has reached 1,000 stickers");
      }
      if ((current.totalBytes ?? 0) + byteSize > STICKER_LIBRARY_MAX_BYTES) {
        throw new Error("Your sticker library has reached its storage limit");
      }
      const entry = await tx.orm.public.UserStickers.select(
        "animated",
        "byteSize",
        "createdAt",
        "favorite",
        "id",
        "mediaId",
        "name",
        "userId"
      ).create({
        animated,
        byteSize,
        favorite: false,
        mediaId: media.id,
        name: parsed.data.name,
        userId: user.id,
      });
      await tx.orm.public.PostMedia.where({ id: media.id }).update({
        visibility: "PRIVATE",
      });
      return entry;
    });
    return NextResponse.json(
      {
        item: {
          animated: saved.animated,
          byteSize: saved.byteSize,
          favorite: saved.favorite,
          height: full.height ?? 0,
          id: saved.id,
          mediaId: saved.mediaId,
          name: saved.name,
          thumbnailUrl: mediaUrls(saved.mediaId).thumbnailUrl,
          url: mediaUrls(saved.mediaId).url,
          width: full.width ?? 0,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Sticker could not be saved",
      },
      { status: 409 }
    );
  }
}
