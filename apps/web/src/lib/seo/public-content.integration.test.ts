import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { prisma } from "@asm/db";

import { getHashtagPostPage } from "@/lib/posts/hashtag-posts";
import { getRecentPostDataForCrawl } from "@/lib/posts/server-feed";

import { getSitemapEntries } from "./sitemap";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
const isolatedDatabase =
  ["127.0.0.1", "localhost"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname.startsWith("/asm_seo_audit_");

describe.skipIf(!isolatedDatabase)(
  "public content SEO on an isolated local database",
  () => {
    const owner = randomUUID();
    const bannedOwner = randomUUID();
    const privateCommunity = randomUUID();
    const publicCommunity = randomUUID();
    const gustId = randomUUID();
    const safeIds = Array.from({ length: 21 }, () => randomUUID());
    const hiddenIds = Array.from({ length: 5 }, () => randomUUID());
    const tagIds = Array.from({ length: 3 }, () => randomUUID());
    const safeTag = `seo_public_${owner}`;
    const hiddenTag = `seo_private_${owner}`;
    const emptyTag = `seo_empty_${owner}`;

    beforeAll(async () => {
      await prisma.orm.public.Users.createAll([
        {
          displayName: "SEO audit author",
          email: `${owner}@example.test`,
          id: owner,
          username: `seo_${owner}`,
        },
        {
          banned: true,
          displayName: "Hidden SEO fixture author",
          email: `${bannedOwner}@example.test`,
          id: bannedOwner,
          username: `seo_${bannedOwner}`,
        },
      ]);
      await prisma.orm.public.Communities.create({
        _type: "PRIVATE",
        description: "Isolated SEO fixture",
        id: privateCommunity,
        name: "Private fixture",
        ownerId: owner,
        slug: `seo-${owner}`,
      });
      await prisma.orm.public.Communities.create({
        description: "Public hashtag fixture",
        id: publicCommunity,
        name: "Public topic fixture",
        ownerId: owner,
        slug: `seo-public-${owner}`,
      });
      await prisma.orm.public.Posts.createAll([
        ...safeIds.map((id, index) => ({
          content: `SEO public fixture conversation ${index} about independent social networks #onepiece${index === 0 ? "fan" : ""}`,
          id,
          userId: owner,
          ...(index === 1 ? { communityId: publicCommunity } : {}),
        })),
        {
          content: "SEO public fixture video caption",
          id: gustId,
          isGust: true,
          userId: owner,
        },
        {
          communityId: privateCommunity,
          content: "SEO hidden private conversation #onepiece",
          id: hiddenIds[0],
          userId: owner,
        },
        {
          content: "SEO hidden moderated conversation #onepiece",
          id: hiddenIds[1],
          moderated: true,
          userId: owner,
        },
        {
          content: "SEO hidden banned author conversation #onepiece",
          id: hiddenIds[2],
          userId: bannedOwner,
        },
        {
          content: "SEO hidden #porn conversation #onepiece",
          id: hiddenIds[3],
          userId: owner,
        },
        {
          content: "SEO hidden semantic classification #onepiece",
          id: hiddenIds[4],
          semanticTags: ["porn"],
          userId: owner,
        },
      ]);
      await prisma.orm.public.PostMedia.create({
        _type: "VIDEO",
        id: randomUUID(),
        mimeType: "video/mp4",
        postId: gustId,
        status: "READY",
        url: "https://example.test/seo-fixture.mp4",
        userId: owner,
      });
      await prisma.orm.public.Tag.createAll([
        { id: tagIds[0], name: safeTag },
        { id: tagIds[1], name: hiddenTag },
        { id: tagIds[2], name: emptyTag },
      ]);
      await prisma.orm.public.PostToTag.createAll([
        { a: safeIds[0], b: tagIds[0] },
        { a: hiddenIds[0], b: tagIds[1] },
      ]);
    }, 30_000);

    afterAll(async () => {
      await prisma.orm.public.Tag.where((tag) =>
        tag.id.in(tagIds)
      ).deleteAndCount();
      await prisma.orm.public.Users.where((user) =>
        user.id.in([owner, bannedOwner])
      ).deleteAndCount();
    }, 30_000);

    test("guest server rendering excludes private, moderated, banned, text-labeled and semantically explicit posts", async () => {
      const posts = await getRecentPostDataForCrawl(100);
      expect(new Set(posts.map((post) => post.id))).toEqual(new Set(safeIds));
      const tagged = await getRecentPostDataForCrawl(20, { tag: safeTag });
      expect(tagged.map((post) => post.id)).toEqual([safeIds[0]]);
      const authored = await getRecentPostDataForCrawl(100, {
        userId: bannedOwner,
      });
      expect(authored).toEqual([]);
    });

    test("sitemaps advertise populated public topics and safe posts", async () => {
      const tags = await getSitemapEntries("tags");
      expect(tags.some((tag) => tag.url.endsWith(safeTag))).toBe(true);
      expect(
        tags.some(
          (tag) => tag.url.endsWith(hiddenTag) || tag.url.endsWith(emptyTag)
        )
      ).toBe(false);
      const posts = await getSitemapEntries("posts");
      for (const id of hiddenIds) {
        expect(posts.some((post) => post.url.includes(id.slice(0, 8)))).toBe(
          false
        );
      }
    });

    test("hashtag queries find unregistered text tags and exclude longer tag names", async () => {
      const page = await getHashtagPostPage("ONEPIECE");
      const second = page.nextCursor
        ? await getHashtagPostPage("onepiece", "", false, page.nextCursor)
        : { posts: [] };
      expect(
        new Set([...page.posts, ...second.posts].map((post) => post.id))
      ).toEqual(new Set(safeIds.slice(1)));
      expect(
        [...page.posts, ...second.posts].some(
          (post) => post.community?.slug === `seo-public-${owner}`
        )
      ).toBe(true);
      const declared = await getHashtagPostPage(safeTag);
      expect(declared.posts.map((post) => post.id)).toEqual([safeIds[0]]);
    });

    test("sparse native hashtag pages advance past unrelated prefix matches", async () => {
      const unrelated = Array.from({ length: 70 }, () => randomUUID());
      await prisma.orm.public.Posts.createAll(
        unrelated.map((id) => ({
          content: "An unrelated #onepiecefan post",
          id,
          userId: owner,
        }))
      );
      try {
        const first = await getHashtagPostPage("onepiece");
        expect(first.posts.length).toBe(0);
        expect(first.nextCursor).not.toBeNull();
        const second = await getHashtagPostPage(
          "onepiece",
          "",
          false,
          first.nextCursor ?? undefined
        );
        expect(new Set(second.posts.map((post) => post.id))).toEqual(
          new Set(safeIds.slice(1))
        );
      } finally {
        await prisma.orm.public.Posts.where((post) =>
          post.id.in(unrelated)
        ).deleteAndCount();
      }
    });

    const base = process.env.SEO_AUDIT_URL;
    test.skipIf(!base)(
      "existing homepage, profile and hashtag cards render before JavaScript",
      async () => {
        if (
          !base ||
          !["localhost", "127.0.0.1"].includes(new URL(base).hostname)
        ) {
          throw new Error("A loopback SEO_AUDIT_URL is required");
        }
        for (const route of [
          "/",
          `/users/seo_${owner}`,
          `/hashtag/${safeTag}`,
        ]) {
          // oxlint-disable-next-line no-await-in-loop -- keep fixture HTTP requests sequential for deterministic cache observations.
          const response = await fetch(new URL(route, base), {
            signal: AbortSignal.timeout(30_000),
          });
          // oxlint-disable-next-line no-await-in-loop -- consume each response while its fixture is still present.
          const html = await response.text();
          expect(response.status).toBe(200);
          expect(html).toContain("SEO public fixture conversation");
          expect(html).toContain("<article");
          expect(html).not.toContain("SEO hidden private conversation");
          expect(html).not.toContain("SEO hidden semantic classification");
          expect(html).not.toContain("Browse public posts");
          expect(html).not.toContain("More public conversations");
          expect(html).not.toContain("Recent public posts about");
          expect(html).not.toContain("<details");
        }
      },
      90_000
    );

    test.skipIf(!base)(
      "built pages exclude thin readers and missing Gusts from indexing",
      async () => {
        if (
          !base ||
          !["localhost", "127.0.0.1"].includes(new URL(base).hostname)
        ) {
          throw new Error("A loopback SEO_AUDIT_URL is required");
        }
        const routes = [
          "/network/bluesky",
          "/network/bluesky/profile",
          "/hashtag/no-local-tag-record",
          "/gusts?id=missing-seo-fixture",
          `/gusts?id=${safeIds[0]}`,
          `/hashtag/${hiddenTag}`,
          `/hashtag/${emptyTag}`,
        ];
        for (const route of routes) {
          // oxlint-disable-next-line no-await-in-loop -- check every route while its isolated fixtures exist.
          const response = await fetch(new URL(route, base), {
            signal: AbortSignal.timeout(30_000),
          });
          // oxlint-disable-next-line no-await-in-loop -- noindex may be streamed after the initial response shell.
          const html = await response.text();
          expect(html).toMatch(/<meta name="robots" content="noindex/);
          expect(html).not.toContain("SEO hidden private conversation");
        }
        const gust = await fetch(new URL(`/gusts?id=${gustId}`, base));
        const gustHtml = await gust.text();
        const gustBody = gustHtml
          .replaceAll(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
          .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
          .replaceAll(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
          .replaceAll(/<meta\b[^>]*>/gi, "");
        expect(gustBody).toContain("SEO public fixture video caption");
        const deletedArchive = await fetch(new URL("/posts", base));
        expect(deletedArchive.status).toBe(404);
        const topic = await fetch(new URL("/hashtag/onepiece", base));
        const topicHtml = await topic.text();
        expect(topic.status).toBe(200);
        expect(topicHtml).toContain("#onepiece");
        expect(topicHtml).toContain("SEO public fixture conversation");
        expect(topicHtml).not.toContain("noindex");
        const endpoint = await fetch(
          new URL("/api/hashtags/onepiece/posts", base)
        );
        expect(endpoint.status).toBe(200);
        const endpointPage = await endpoint.json();
        expect(endpointPage.posts.length).toBe(20);
        expect(
          endpointPage.posts.some((post: { content: string }) =>
            post.content.includes("#onepiecefan")
          )
        ).toBe(false);
        const unchangedPages = await Promise.all(
          ["/about", "/discover"].map(async (route) => {
            const response = await fetch(new URL(route, base));
            return response.text();
          })
        );
        for (const html of unchangedPages) {
          expect(html).not.toContain("Bluesky discovery");
          expect(html).not.toContain("Recent public posts");
          expect(html).not.toContain("Browse all public posts");
        }
      },
      90_000
    );
  }
);
