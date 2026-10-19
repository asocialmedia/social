// Run against local Postgres/Redis/auth and real Bluesky: bun --env-file=.env.test scripts/testing/audit-live-feeds.ts --keep.
// oxlint-disable no-await-in-loop
import { createHmac } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";

import { closePrisma, prisma, redis, toPrismaDateTime } from "@asm/db";
import { externalPostTopics } from "@asm/protocols/contracts";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  defaultNetworkPreferences,
  isExternalTrendingPost,
  networkInterestScore,
} from "@asm/protocols/discovery";
import type { NetworkSettings } from "@asm/protocols/discovery";

const base = new URL(process.env.FEED_AUDIT_URL ?? "http://localhost:3000");
if (
  !["localhost", "127.0.0.1"].includes(base.hostname) ||
  !process.env.DATABASE_URL?.includes("localhost")
)
  throw new Error("Live audit requires local application and database");
const run = crypto.randomUUID();
const fixtureFile =
  process.env.FEED_AUDIT_FIXTURES ??
  "/tmp/asm-feed-audit-browser-fixtures.json";
const keep = Bun.argv.includes("--keep");
const cleanup = Bun.argv.includes("--cleanup");
const reuse = Bun.argv.includes("--reuse");
const personas = [
  {
    name: "Web developer",
    interests: ["software", "web development", "typescript"],
  },
  { name: "Anime and manga", interests: ["anime", "manga"] },
  { name: "Astronomy", interests: ["astronomy"] },
  { name: "Gardening", interests: ["gardening"] },
];
const viewers =
  cleanup || reuse
    ? ((await Bun.file(fixtureFile).json()) as {
        id: string;
        name: string;
        token: string;
        cookie: string;
        interests: string[];
      }[])
    : personas.map((persona) => {
        const token = crypto.randomUUID() + crypto.randomUUID();
        const signature = createHmac(
          "sha256",
          process.env.BETTER_AUTH_SECRET ?? ""
        )
          .update(token)
          .digest("base64");
        return {
          ...persona,
          id: `feed-audit-${run}-${persona.name.toLowerCase().replaceAll(/[^a-z]/g, "")}`,
          token,
          cookie: encodeURIComponent(`${token}.${signature}`),
        };
      });
if (viewers.some((viewer) => !viewer.id.startsWith("feed-audit-")))
  throw new Error("Refusing to clean unrelated accounts");
const rows: Record<string, unknown>[] = [];
try {
  if (cleanup) {
    console.log(JSON.stringify({ cleanup: viewers.length }));
  } else {
    if (!reuse) {
      await prisma.orm.public.Users.createAll(
        viewers.map((viewer) => ({
          id: viewer.id,
          username: viewer.id,
          displayName: viewer.name,
          networkPreferences: {
            ...defaultNetworkPreferences(),
            language: "en",
            contentLanguages: ["en"],
            region: "all",
            profiles: [
              { id: "default", name: viewer.name, interests: viewer.interests },
            ],
          },
        }))
      );
      await prisma.orm.public.Sessions.createAll(
        viewers.map((viewer) => ({
          userId: viewer.id,
          token: viewer.token,
          expiresAt: toPrismaDateTime(new Date(Date.now() + 45 * 60_000)),
        }))
      );
    }
    if (keep) {
      await Bun.write(fixtureFile, JSON.stringify(viewers));
      await chmod(fixtureFile, 0o600);
    }
    for (const [index, viewer] of viewers.entries()) {
      const headers = {
        authorization: `Bearer ${viewer.token}`,
        "x-forwarded-for": `198.19.1.${index + 1}`,
        "cf-connecting-ip": `198.19.1.${index + 1}`,
      };
      const settings = (await fetch(new URL("/api/network/preferences", base), {
        headers,
      }).then((response) => response.json())) as NetworkSettings;
      if (
        JSON.stringify(settings.preferences.profiles[0]?.interests) !==
        JSON.stringify(viewer.interests)
      )
        throw new Error("Persona authentication mismatch");
      for (const round of ["first", "repeat"]) {
        const seen = new Set<string>();
        for (const [surface, mode, content] of [
          ["home", "personalized", "all"],
          ["home", "trending", "all"],
          ["home", "latest", "all"],
          ["explore", "personalized", "all"],
          ["gusts", "personalized", "video"],
          ["gusts", "trending", "video"],
        ] as const) {
          const query = new URLSearchParams({
            mode,
            content,
            locale: "en",
            profile: "default",
            refresh: "1",
          });
          if (surface === "explore") query.set("surface", "explore");
          const began = performance.now();
          const response = await fetch(
            new URL(`/api/protocols/bluesky/discover?${query}`, base),
            { headers, signal: AbortSignal.timeout(30_000) }
          );
          const page = (await response.json()) as {
            items?: ExternalPost[];
            cursor?: string | null;
            partial?: boolean;
            error?: string;
          };
          const items = page.items ?? [];
          const offTopic = items.filter(
            (post) =>
              networkInterestScore(
                `${post.text} ${post.externalLink?.title ?? ""} ${post.externalLink?.description ?? ""} ${post.media.map((media) => media.alt).join(" ")}`,
                externalPostTopics(post),
                viewer.interests,
                settings.topicScope
              ) === 0
          );
          const quiet =
            mode === "trending"
              ? items.filter((post) => !isExternalTrendingPost(post))
              : [];
          const row = {
            persona: viewer.name,
            round,
            surface,
            mode,
            content,
            status: response.status,
            ms: Math.round(performance.now() - began),
            count: items.length,
            partial: page.partial,
            offTopic: offTopic.length,
            quiet: quiet.length,
            rawOverlapWithPreviousSections: items.filter((post) =>
              seen.has(post.id)
            ).length,
            novelAfterClientExposureFilter: items.filter(
              (post) => !seen.has(post.id)
            ).length,
            cursor: Boolean(page.cursor),
            examples: items.slice(0, 3).map((post) => ({
              text: post.text,
              url: post.url,
              counts: post.upstreamCounts,
            })),
          };
          rows.push(row);
          for (const post of items) seen.add(post.id);
          console.log(JSON.stringify({ ...row, examples: undefined }));
          if (!response.ok || offTopic.length || quiet.length)
            process.exitCode = 1;
          if (surface === "gusts" && mode === "personalized" && page.cursor) {
            query.set("cursor", page.cursor);
            const nextAt = performance.now();
            const nextResponse = await fetch(
              new URL(`/api/protocols/bluesky/discover?${query}`, base),
              { headers, signal: AbortSignal.timeout(30_000) }
            );
            const next = (await nextResponse.json()) as {
              items?: ExternalPost[];
              cursor?: string | null;
            };
            const duplicates =
              next.items?.filter((post) =>
                items.some((previous) => previous.id === post.id)
              ).length ?? 0;
            rows.push({
              persona: viewer.name,
              round,
              surface: "gusts-page-2",
              status: nextResponse.status,
              ms: Math.round(performance.now() - nextAt),
              count: next.items?.length ?? 0,
              duplicates,
              cursor: Boolean(next.cursor),
            });
            if (!nextResponse.ok || duplicates) process.exitCode = 1;
          }
        }
      }
    }
    await mkdir("artifacts/feed-audit", { recursive: true });
    const output = `artifacts/feed-audit/live-${run}.json`;
    await Bun.write(
      output,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          environment:
            "Local Next development server, real Postgres/Redis/auth and public Bluesky data",
          rows,
        },
        null,
        2
      )
    );
    console.log(JSON.stringify({ report: output, keptForBrowser: keep }));
  }
} finally {
  if (!keep || cleanup) {
    await prisma.orm.public.Users.where((user) =>
      user.id.in(viewers.map((viewer) => viewer.id))
    ).deleteAndCount();
    if (cleanup) {
      await rm(fixtureFile, { force: true });
    }
  }
  await closePrisma();
  redis.disconnect();
}
