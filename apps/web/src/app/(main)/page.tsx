import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import HomePageSkeleton from "@/components/layouts/skeletons/home-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";
import { getRecentPostsForCrawl } from "@/lib/posts/server-feed";
import { getPostPath, getPostUrl } from "@/lib/seo/seo";

import ClientHome from "./client-home";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  description:
    "asocialmedia is the social network that knows you back. A feed that learns your taste, Aura that remembers what you contribute, and communities you have to earn. No ads, and nothing sold to anyone.",
  keywords: [
    "asocialmedia",
    "asocialmedia.cc",
    "asocial media",
    "social network",
    "social media",
    "personalized social feed",
    "social feed that learns you",
    "reputation system social media",
    "aura social media",
    "social media without ads",
    "social media alternative",
    "guest browsing social media",
  ],
  openGraph: {
    description:
      "A feed that learns your taste. Aura that remembers what you contribute. Communities you have to earn. asocialmedia is the social network that knows you back.",
    siteName: siteConfig.name,
    title: siteConfig.brandLine,
    type: "website",
    url: siteConfig.url,
  },
  // `absolute`, not a string: the root layout appends its `%s | name` template
  // to every child title, which would render the brand twice on the homepage
  // ("asocialmedia — The social network that knows you back. | asocialmedia").
  title: { absolute: `${siteConfig.name} — ${siteConfig.brandLine}` },
};

// The page shell is synchronous so the router can stream it immediately; the
// session and user lookups resolve inside the Suspense boundary and replace
// the skeleton when ready.
export default function Page() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  // Marks this subtree request-bound before any read. Prisma 8 stamps every
  // query with a crypto.randomUUID() plan id, and Next's Cache Components
  // prerender rejects an uncached value it cannot bake into a static shell, so
  // an unclaimed database read in the shell aborts the prerender. The session
  // lookup only reads headers() for guests on some paths, which does not claim
  // the scope either - the explicit connection() does, and the Suspense
  // boundary above keeps the shell prerenderable.
  await connection();

  const session = await getSessionFromApi();

  // Guests can browse the home feed; the client decides which tabs and
  // interactive features are available without an account.
  const userData = session?.user ? await getUserData(session.user.id) : null;

  // JSON-LD ItemList gives crawlers the post graph without any visual noise.
  // Visible crawlable feeds were removed per design request - the sitemap +
  // JSON-LD + noscript is enough for the link graph while that other agent
  // handles SSR hydration separately.
  const recentPosts = await getRecentPostsForCrawl(12);

  const itemListJsonLd =
    recentPosts.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: recentPosts.slice(0, 10).map((post, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: getPostUrl(post),
          })),
          name: "Latest eddies on asocialmedia",
          numberOfItems: recentPosts.length,
        }
      : null;

  return (
    <>
      {itemListJsonLd ? <JsonLd data={itemListJsonLd} /> : null}
      <ClientHome userData={userData} />
      {/* Visually hidden but present in raw HTML for crawlers / no-JS. The
          homepage is the live feed, so the prose that describes the product
          lives on /about, not stacked under the timeline. */}
      <div className="sr-only" aria-hidden={false}>
        <h1>{siteConfig.brandLine}</h1>
        <p>
          asocialmedia is an open social network where the feed learns your
          taste, Aura records your reputation, and communities are earned rather
          than spammed. <Link href="/about">Read what it is.</Link>
        </p>
        <nav aria-label="Latest fleets">
          <ul>
            {recentPosts.map((post) => (
              <li key={post.id}>
                <a href={getPostPath(post)} tabIndex={-1}>
                  {post.content || post.id}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <noscript>
        <div style={{ padding: 16 }}>
          <p>
            JavaScript is disabled. Browse recent posts:{" "}
            {recentPosts.slice(0, 10).map((p, i) => (
              <span key={p.id}>
                {i > 0 ? ", " : ""}
                <a href={getPostPath(p)}>{p.content || p.id}</a>
              </span>
            ))}
          </p>
        </div>
      </noscript>
    </>
  );
}
