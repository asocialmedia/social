import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { prisma } from "@asm/db";

import {
  getFirstPublicHashtagPage,
  getHashtagPostPage,
} from "@/lib/posts/hashtag-posts";
import {
  crawlPostHref,
  getRecentPostDataForCrawl,
  getRecentPostsForCrawl,
  getRecentGustsForCrawl,
} from "@/lib/posts/server-feed";

import { getPostUrl } from "./seo";
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

    test("normalized candidate reads preserve member visibility and explicit opt-in", async () => {
      const membership = randomUUID();
      await prisma.orm.public.CommunityMembers.create({
        communityId: privateCommunity,
        id: membership,
        status: "ACTIVE",
        userId: owner,
      });
      try {
        const page = await getHashtagPostPage("onepiece", owner, true);
        expect(page.posts.some((post) => post.id === hiddenIds[0])).toBe(true);
        expect(
          page.posts.some(
            (post) => post.id === hiddenIds[1] || post.id === hiddenIds[2]
          )
        ).toBe(false);
        const guest = await getHashtagPostPage("onepiece");
        expect(guest.posts.some((post) => post.id === hiddenIds[0])).toBe(
          false
        );
      } finally {
        await prisma.orm.public.CommunityMembers.where({
          id: membership,
        }).deleteAndCount();
      }
    });

    test("native hashtag queries reject unrelated prefixes before hydration", async () => {
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
        expect(new Set(first.posts.map((post) => post.id))).toEqual(
          new Set(safeIds.slice(1))
        );
        expect(first.nextCursor).toBeNull();
      } finally {
        await prisma.orm.public.Posts.where((post) =>
          post.id.in(unrelated)
        ).deleteAndCount();
      }
    });

    test("server hashtag lookahead stops after three sparse pages and preserves continuation", async () => {
      const id = randomUUID();
      const unrelated = Array.from({ length: 200 }, () => randomUUID());
      const tag = `bounded_${owner}`;
      await prisma.orm.public.Posts.create({
        content: `An actual public topic #${tag}`,
        id,
        userId: owner,
      });
      await prisma.orm.public.Posts.createAll(
        unrelated.map((postId) => ({
          content: `A filtered topic #${tag}`,
          id: postId,
          semanticTags: ["porn"],
          userId: owner,
        }))
      );
      try {
        const page = await getFirstPublicHashtagPage(tag);
        expect(page.posts).toEqual([]);
        expect(page.nextCursor).not.toBeNull();
        const continuation = await getHashtagPostPage(
          tag,
          "",
          false,
          page.nextCursor ?? undefined
        );
        expect(continuation.posts.map((post) => post.id)).toEqual([id]);
      } finally {
        await prisma.orm.public.Posts.where((post) =>
          post.id.in([id, ...unrelated])
        ).deleteAndCount();
      }
    });

    test("crawl links keep the full content required for canonical slugs", async () => {
      const id = randomUUID();
      const content =
        "A meaningful conversation about the interconnected questions that arise when communities build independent social networks and share their discoveries";
      await prisma.orm.public.Posts.create({ content, id, userId: owner });
      try {
        const posts = await getRecentPostsForCrawl(100);
        const post = posts.find((candidate) => candidate.id === id);
        expect(post).toBeDefined();
        if (post) {
          expect(crawlPostHref(post)).toBe(getPostUrl({ content, id }));
        }
      } finally {
        await prisma.orm.public.Posts.where({ id }).deleteAndCount();
      }
    });

    test("sitemap and crawl projections exclude explicit tag, media text and embed labels", async () => {
      const ids = Array.from({ length: 6 }, () => randomUUID());
      const existing = await prisma.orm.public.Tag.where({
        name: "porn",
      }).first();
      const tagId = existing?.id ?? randomUUID();
      if (!existing) {
        await prisma.orm.public.Tag.create({ id: tagId, name: "porn" });
      }
      await prisma.orm.public.Posts.createAll(
        ids.map((id, index) => ({
          content: "A post whose public eligibility depends on related data",
          id,
          isGust: index >= 3,
          userId: owner,
          ...(index % 3 === 2
            ? {
                embeds: [
                  { title: "#porn", type: "link", url: "https://example.com" },
                ],
              }
            : {}),
        }))
      );
      await prisma.orm.public.PostToTag.createAll([
        { a: ids[0], b: tagId },
        { a: ids[3], b: tagId },
      ]);
      await prisma.orm.public.PostMedia.createAll(
        [1, 4].map((index) => ({
          _type: "VIDEO" as const,
          altText: "#porn",
          id: randomUUID(),
          mimeType: "video/mp4",
          postId: ids[index],
          status: "READY" as const,
          url: "https://example.test/hidden.mp4",
          userId: owner,
        }))
      );
      try {
        const entries = [
          ...(await getSitemapEntries("posts")),
          ...(await getSitemapEntries("gusts")),
        ];
        const crawl = [
          ...(await getRecentPostsForCrawl(100)),
          ...(await getRecentGustsForCrawl(100)),
        ];
        for (const id of ids) {
          expect(
            entries.some((entry) => entry.url.includes(id.slice(0, 8)))
          ).toBe(false);
          expect(crawl.some((post) => post.id === id)).toBe(false);
        }
      } finally {
        await prisma.orm.public.Posts.where((post) =>
          post.id.in(ids)
        ).deleteAndCount();
        if (!existing) {
          await prisma.orm.public.Tag.where({ id: tagId }).deleteAndCount();
        }
      }
    });

    test("compatibility Unicode spellings remain searchable in stored text and tags", async () => {
      const id = randomUUID();
      const tagId = randomUUID();
      await prisma.orm.public.Posts.create({
        content: "A public conversation #ＯｎｅＰｉｅｃｅ",
        id,
        userId: owner,
      });
      await prisma.orm.public.Tag.create({
        id: tagId,
        name: "ＯｎｅＰｉｅｃｅ",
      });
      await prisma.orm.public.PostToTag.create({ a: id, b: tagId });
      try {
        const page = await getHashtagPostPage("ＯｎｅＰｉｅｃｅ");
        expect(page.posts.map((post) => post.id)).toContain(id);
      } finally {
        await prisma.orm.public.Posts.where({ id }).deleteAndCount();
        await prisma.orm.public.Tag.where({ id: tagId }).deleteAndCount();
      }
    });

    test("Unicode native hashtags match accents and case in existing text and tag relations", async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const tags = [randomUUID(), randomUUID()];
      await prisma.orm.public.Posts.createAll([
        { content: "A summer trip #ÉTÉ", id: ids[0], userId: owner },
        { content: "A morning cup #cafe\u0301", id: ids[1], userId: owner },
        { content: "A linked public tag", id: ids[2], userId: owner },
      ]);
      await prisma.orm.public.Tag.createAll([
        { id: tags[0], name: "Été" },
        { id: tags[1], name: "cafe\u0301" },
      ]);
      await prisma.orm.public.PostToTag.createAll([
        { a: ids[2], b: tags[0] },
        { a: ids[2], b: tags[1] },
      ]);
      try {
        const summer = await getHashtagPostPage("été");
        expect(new Set(summer.posts.map((post) => post.id))).toEqual(
          new Set([ids[0], ids[2]])
        );
        const coffee = await getHashtagPostPage("CAFÉ");
        expect(new Set(coffee.posts.map((post) => post.id))).toEqual(
          new Set([ids[1], ids[2]])
        );
      } finally {
        await prisma.orm.public.Posts.where((post) =>
          post.id.in(ids)
        ).deleteAndCount();
        await prisma.orm.public.Tag.where((tag) =>
          tag.id.in(tags)
        ).deleteAndCount();
      }
    });

    test("tag sitemap scans beyond unsafe candidates and deduplicates case variants", async () => {
      const ids = Array.from({ length: 25 }, () => randomUUID());
      const tags = [randomUUID(), randomUUID()];
      const name = `mixed_${owner}`;
      await prisma.orm.public.Tag.createAll([
        { id: tags[0], name },
        { id: tags[1], name: name.toUpperCase() },
      ]);
      await prisma.orm.public.Posts.createAll(
        ids.map((id, index) => ({
          content: "A public topic conversation",
          id,
          semanticTags: index < 24 ? ["porn"] : [],
          userId: owner,
        }))
      );
      await prisma.orm.public.PostToTag.createAll([
        ...ids.map((id) => ({ a: id, b: tags[0] })),
        { a: ids[24], b: tags[1] },
      ]);
      try {
        const entries = await getSitemapEntries("tags");
        expect(entries.filter((entry) => entry.url.endsWith(name)).length).toBe(
          1
        );
      } finally {
        await prisma.orm.public.Posts.where((post) =>
          post.id.in(ids)
        ).deleteAndCount();
        await prisma.orm.public.Tag.where((tag) =>
          tag.id.in(tags)
        ).deleteAndCount();
      }
    });

    const base = process.env.SEO_AUDIT_URL;
    test.skipIf(!base)(
      "tag sitemap reuses its server entry set across origin requests",
      async () => {
        if (
          !base ||
          !["localhost", "127.0.0.1"].includes(new URL(base).hostname)
        ) {
          throw new Error("Loopback preview required");
        }
        const beforeResponse = await fetch(new URL("/sitemaps/tags.xml", base));
        const before = await beforeResponse.text();
        expect(beforeResponse.status).toBe(200);
        const id = randomUUID();
        const tagId = randomUUID();
        const name = `cached_${owner}`;
        await prisma.orm.public.Posts.create({
          content: "A newly inserted public topic",
          id,
          userId: owner,
        });
        await prisma.orm.public.Tag.create({ id: tagId, name });
        await prisma.orm.public.PostToTag.create({ a: id, b: tagId });
        try {
          const fresh = await getSitemapEntries("tags");
          expect(fresh.some((entry) => entry.url.endsWith(name))).toBe(true);
          const cachedResponse = await fetch(
            new URL("/sitemaps/tags.xml", base)
          );
          const cached = await cachedResponse.text();
          expect(cachedResponse.status).toBe(200);
          expect(cached).toBe(before);
        } finally {
          await prisma.orm.public.Posts.where({ id }).deleteAndCount();
          await prisma.orm.public.Tag.where({ id: tagId }).deleteAndCount();
        }
      }
    );

    test.skipIf(!base)(
      "a moderated Gust is not rendered from the metadata cache",
      async () => {
        if (
          !base ||
          !["localhost", "127.0.0.1"].includes(new URL(base).hostname)
        ) {
          throw new Error("Loopback preview required");
        }
        const id = randomUUID();
        await prisma.orm.public.Posts.create({
          content: "SEO cached Gust moderation regression",
          id,
          isGust: true,
          userId: owner,
        });
        try {
          const beforeResponse = await fetch(new URL(`/gusts?id=${id}`, base));
          const before = await beforeResponse.text();
          expect(before).toContain("SocialMediaPosting");
          await prisma.orm.public.Posts.where({ id }).update({
            moderated: true,
          });
          const afterResponse = await fetch(new URL(`/gusts?id=${id}`, base));
          const after = await afterResponse.text();
          expect(after).not.toContain("SocialMediaPosting");
          expect(after).toContain("noindex");
        } finally {
          await prisma.orm.public.Posts.where({ id }).deleteAndCount();
        }
      }
    );

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
