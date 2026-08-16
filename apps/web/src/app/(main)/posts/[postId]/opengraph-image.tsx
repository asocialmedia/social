// oxlint-disable next/no-img-element -- Satori image generation requires native img elements
import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "@asm/db";
import { cacheLife, cacheTag } from "next/cache";
import { ImageResponse } from "next/og";

import { excerpt, toAbsoluteUrl } from "@/lib/seo";

export const alt = "asocialmedia post";
export const size = {
  height: 630,
  width: 1200,
};
export const contentType = "image/png";

// The card is 1200x630; when a media thumbnail is shown it takes the right
// ~520px, leaving the left column for text.
const CONTENT_MAX = 190;
const CONTENT_MAX_WITH_MEDIA = 130;

const INDEX_SEGMENT_PATTERN = /^\d+$/;

// Post content is immutable while stats (aura/votes/eddies) drift, so the card
// data is cached for an hour and re-rendered on cache expiry. Social crawlers
// hammer these URLs when a post goes viral; caching turns a DB query + full
// render into a pure cache hit. The response itself already ships
// `Cache-Control: public, immutable, max-age=31536000` in production. The
// "og-post-card" tag lets the delete action expire the card immediately.
async function getPostForCard(postId: string) {
  "use cache";
  cacheLife("hours");
  cacheTag("og-post-card");

  return await prisma.post.findUnique({
    select: {
      _count: { select: { comments: true, vote: true } },
      attachments: true,
      aura: true,
      content: true,
      createdAt: true,
      id: true,
      tags: { select: { name: true } },
      user: {
        select: {
          displayName: true,
          id: true,
          username: true,
        },
      },
    },
    where: { id: postId },
  });
}

// The Docker build runs `next build apps/web` from the monorepo root, so
// process.cwd() is "/app" there but "apps/web" locally (and the app dir when
// run from within it). Try every plausible font directory so the route builds
// and runs in both local and container contexts.
const FONT_CANDIDATES = [
  path.join(process.cwd(), "public", "fonts"),
  path.join(process.cwd(), "apps", "web", "public", "fonts"),
  path.join(process.cwd(), "..", "apps", "web", "public", "fonts"),
];

function loadFont(file: string): Buffer {
  for (const dir of FONT_CANDIDATES) {
    const candidate = path.join(dir, file);
    try {
      return readFileSync(candidate);
    } catch (error) {
      // Only a missing file means this candidate doesn't exist - keep probing
      // the other directories. Anything else (permission, I/O, bad path) is a
      // real failure that should surface instead of being swallowed.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error(
    `Could not locate font ${file}; searched: ${FONT_CANDIDATES.join(", ")}`
  );
}

const fonts = {
  bold: loadFont("SofiaProSoftBold.woff2"),
  medium: loadFont("SofiaProSoftMed.woff2"),
  regular: loadFont("SofiaProSoftReg.woff2"),
};

const fontOptions = [
  { data: fonts.bold, name: "SofiaProSoft", style: "normal", weight: 700 },
  { data: fonts.medium, name: "SofiaProSoft", style: "normal", weight: 500 },
  { data: fonts.regular, name: "SofiaProSoft", style: "normal", weight: 400 },
] as const;

interface PostCardData {
  attachments: {
    id: string;
    type: string;
    width: number | null;
    height: number | null;
    thumbnailKey: string | null;
    thumbnailWidth: number | null;
    thumbnailHeight: number | null;
  }[];
  aura: number;
  content: string;
  createdAt: Date;
  tags: { name: string }[];
  user: { displayName: string; id: string; username: string };
  _count: { comments: number; vote: number };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

// Images always render in the card; videos render when the uploader stored a
// thumbnail frame (served via ?thumb=1). For the shareable media route the
// index param selects a specific attachment.
function isCardPreviewable(
  media: PostCardData["attachments"][number]
): boolean {
  return (
    media.type.toLowerCase().startsWith("image") ||
    (media.type === "VIDEO" && Boolean(media.thumbnailKey))
  );
}

function getCardMedia(
  post: PostCardData,
  index: string | undefined
): PostCardData["attachments"][number] | undefined {
  if (index === undefined) {
    return post.attachments.find((a) => isCardPreviewable(a));
  }
  if (
    INDEX_SEGMENT_PATTERN.test(index) &&
    Number(index) < post.attachments.length
  ) {
    const media = post.attachments[Number(index)];
    if (isCardPreviewable(media)) {
      return media;
    }
  }
  return undefined;
}

export default async function Image({
  params,
}: {
  params: Promise<{ index?: string; postId: string }>;
}) {
  const { index, postId } = await params;

  const post = await getPostForCard(postId);

  if (!post) {
    return new ImageResponse(
      <div
        style={{
          alignItems: "center",
          background: "#111111",
          color: "#fafafa",
          display: "flex",
          fontFamily: "SofiaProSoft",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <span style={{ fontSize: 32 }}>Post not found</span>
      </div>,
      { ...size }
    );
  }

  const showMedia = getCardMedia(post, index);

  const content = excerpt(
    post.content,
    showMedia ? CONTENT_MAX_WITH_MEDIA : CONTENT_MAX
  );

  // Avatar and media are served through the app proxy (buckets are private).
  const avatarUrl = post.user.id
    ? toAbsoluteUrl(`/api/users/avatar/${post.user.id}/image`)
    : null;
  const tagText = post.tags
    .slice(0, 3)
    .map((t) => `#${t.name}`)
    .join("  ");
  const dateText = formatDate(post.createdAt);

  const showVideoThumb = showMedia?.type === "VIDEO";

  const mediaBlock = showMedia
    ? {
        // Video thumbnails use the extracted frame's own dimensions so the
        // card never distorts the crop.
        height: showVideoThumb
          ? (showMedia.thumbnailHeight ?? 630)
          : (showMedia.height ?? 630),
        src:
          toAbsoluteUrl(
            `/api/media/${showMedia.id}${showVideoThumb ? "?thumb=1" : ""}`
          ) ?? "",
        width: showVideoThumb
          ? (showMedia.thumbnailWidth ?? 520)
          : (showMedia.width ?? 520),
      }
    : null;

  return new ImageResponse(
    <div
      style={{
        background: "#111111",
        color: "#fafafa",
        display: "flex",
        fontFamily: "SofiaProSoft",
        height: "100%",
        width: "100%",
      }}
    >
      {
        // Content column
      }
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          minWidth: 0,
          padding: "48px 52px",
        }}
      >
        {
          // Brand row
        }
        <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
          <div
            style={{
              alignItems: "center",
              background: "linear-gradient(180deg, #ff9500 0%, #e65500 100%)",
              borderRadius: 14,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px rgba(230,85,0,0.45)",
              color: "#ffffff",
              display: "flex",
              fontSize: 24,
              fontWeight: 700,
              height: 46,
              justifyContent: "center",
              width: 46,
            }}
          >
            A
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 2.5,
              textTransform: "uppercase",
            }}
          >
            asocialmedia
          </div>
        </div>

        {
          // Author row
        }
        <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
          {avatarUrl ? (
            <img
              alt=""
              height={56}
              src={avatarUrl}
              style={{ borderRadius: 999 }}
              width={56}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {post.user.displayName}
            </div>
            <div style={{ color: "#a1a1aa", fontSize: 17, fontWeight: 500 }}>
              @{post.user.username}
            </div>
          </div>
        </div>

        {
          // Post content
        }
        <div
          style={{
            color: "#f4f4f5",
            display: "flex",
            flexDirection: "column",
            fontSize: 30,
            fontWeight: 500,
            gap: 18,
            lineHeight: 1.35,
          }}
        >
          <div style={{ overflow: "hidden" }}>{content}</div>
          {tagText ? (
            <div
              style={{
                color: "#ff9500",
                fontSize: 22,
                fontWeight: 500,
                overflow: "hidden",
              }}
            >
              {tagText}
            </div>
          ) : null}
        </div>

        {
          // Footer stats
        }
        <div
          style={{
            alignItems: "center",
            borderTop: "1px solid rgba(255,255,255,0.12)",
            color: "#a1a1aa",
            display: "flex",
            fontSize: 18,
            fontWeight: 500,
            gap: 24,
            paddingTop: 20,
          }}
        >
          <span>{post.aura} aura</span>
          <span>{post._count.vote} votes</span>
          <span>{post._count.comments} eddies</span>
          <span>{dateText}</span>
        </div>
      </div>

      {
        // Media column
      }
      {mediaBlock ? (
        <div
          style={{
            display: "flex",
            overflow: "hidden",
            position: "relative",
            width: 520,
          }}
        >
          <img
            alt=""
            height={mediaBlock.height}
            src={mediaBlock.src}
            style={{ objectFit: "cover", width: "100%" }}
            width={mediaBlock.width}
          />
          <div
            style={{
              background:
                "linear-gradient(90deg, #111111 0%, rgba(17,17,17,0) 18%)",
              height: "100%",
              left: 0,
              position: "absolute",
              top: 0,
              width: 110,
            }}
          />
        </div>
      ) : null}
    </div>,
    {
      ...size,
      fonts: [...fontOptions],
    }
  );
}
