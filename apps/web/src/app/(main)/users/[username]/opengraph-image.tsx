// oxlint-disable next/no-img-element -- Satori image generation requires native img elements
import { readFileSync } from "node:fs";
import path from "node:path";

import { getUserBadges, prisma } from "@asm/db";
import { cacheLife, cacheTag } from "next/cache";
import { ImageResponse } from "next/og";

import { excerpt, toAbsoluteUrl } from "@/lib/seo";

export const alt = "asocialmedia user profile";
export const size = {
  height: 630,
  width: 1200,
};
export const contentType = "image/png";

const BIO_MAX = 150;

async function getUserForCard(username: string) {
  "use cache";
  cacheLife("hours");
  cacheTag("og-user-profile");

  return await prisma.user.findFirst({
    select: {
      _count: {
        select: {
          followers: true,
          following: true,
          posts: true,
        },
      },
      aura: true,
      avatarUrl: true,
      badge: true,
      badges: true,
      bannerUrl: true,
      bio: true,
      createdAt: true,
      displayName: true,
      id: true,
      username: true,
    },
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
  });
}

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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await getUserForCard(username);

  if (!user) {
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
        <span style={{ fontSize: 32 }}>User not found</span>
      </div>,
      { ...size }
    );
  }

  const bio = user.bio ? excerpt(user.bio, BIO_MAX) : null;
  const avatarUrl = user.avatarUrl
    ? toAbsoluteUrl(`/api/users/avatar/${user.id}/image`)
    : null;
  const joinedDate = formatDate(user.createdAt);
  const badges = getUserBadges(user);

  return new ImageResponse(
    <div
      style={{
        background: "#0c0c0e",
        color: "#fafafa",
        display: "flex",
        flexDirection: "column",
        fontFamily: "SofiaProSoft",
        height: "100%",
        justifyContent: "space-between",
        padding: "48px 56px",
        position: "relative",
        width: "100%",
      }}
    >
      {/* Background ambient glow */}
      <div
        style={{
          background:
            "radial-gradient(circle at 80% 20%, rgba(255,149,0,0.18) 0%, rgba(230,85,0,0.05) 45%, transparent 70%)",
          height: "100%",
          left: 0,
          position: "absolute",
          top: 0,
          width: "100%",
        }}
      />

      {/* Top row: Brand & Community pill */}
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          zIndex: 1,
        }}
      >
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

        <div
          style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 999,
            color: "#ff9500",
            display: "flex",
            fontSize: 16,
            fontWeight: 600,
            padding: "8px 18px",
          }}
        >
          Profile
        </div>
      </div>

      {/* Main Profile Info */}
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 32,
          zIndex: 1,
        }}
      >
        {avatarUrl ? (
          <div
            style={{
              borderRadius: 999,
              boxShadow:
                "0 0 0 4px rgba(255,149,0,0.4), 0 8px 24px rgba(0,0,0,0.5)",
              display: "flex",
              overflow: "hidden",
            }}
          >
            <img
              alt=""
              height={140}
              src={avatarUrl}
              style={{ objectFit: "cover" }}
              width={140}
            />
          </div>
        ) : (
          <div
            style={{
              alignItems: "center",
              background: "linear-gradient(135deg, #ff9500 0%, #e65500 100%)",
              borderRadius: 999,
              color: "#ffffff",
              display: "flex",
              fontSize: 56,
              fontWeight: 700,
              height: 140,
              justifyContent: "center",
              width: 140,
            }}
          >
            {(user.displayName || user.username)[0]?.toUpperCase()}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxWidth: 880,
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
            <div style={{ fontSize: 38, fontWeight: 700 }}>
              {user.displayName}
            </div>
            {badges.length > 0 ? (
              <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
                <div
                  style={{
                    background:
                      "linear-gradient(180deg, #ff9500 0%, #e65500 100%)",
                    borderRadius: 6,
                    color: "#ffffff",
                    fontSize: 14,
                    fontWeight: 700,
                    padding: "3px 10px",
                    textTransform: "uppercase",
                  }}
                >
                  {badges[0]}
                </div>
                {badges.length > 1 ? (
                  <div
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.16)",
                      borderRadius: 6,
                      color: "#e4e4e7",
                      fontSize: 14,
                      fontWeight: 700,
                      padding: "3px 8px",
                    }}
                  >
                    +{badges.length - 1}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={{ color: "#a1a1aa", fontSize: 22, fontWeight: 500 }}>
            @{user.username}
          </div>

          {bio ? (
            <div
              style={{
                color: "#e4e4e7",
                fontSize: 22,
                fontWeight: 400,
                lineHeight: 1.4,
                marginTop: 4,
              }}
            >
              {bio}
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer stats bar */}
      <div
        style={{
          alignItems: "center",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          color: "#a1a1aa",
          display: "flex",
          fontSize: 20,
          fontWeight: 500,
          gap: 36,
          paddingTop: 22,
          zIndex: 1,
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#ff9500", fontWeight: 700 }}>{user.aura}</span>
          <span>aura</span>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#fafafa", fontWeight: 700 }}>
            {user._count.followers}
          </span>
          <span>followers</span>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#fafafa", fontWeight: 700 }}>
            {user._count.following}
          </span>
          <span>following</span>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#fafafa", fontWeight: 700 }}>
            {user._count.posts}
          </span>
          <span>posts</span>
        </div>
        <div style={{ color: "#71717a", marginLeft: "auto" }}>
          Joined {joinedDate}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [...fontOptions],
    }
  );
}
