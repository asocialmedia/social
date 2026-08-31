import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import HomePageSkeleton from "@/components/layouts/skeletons/home-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/use-user-data";
import { getRecentPostsForCrawl } from "@/lib/server-feed";
import { getSessionFromApi } from "@/lib/session";

import ClientHome from "./client-home";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  description:
    "Browse the global feed on asocialmedia — a cozy, open source social platform. See what's trending, explore hashtags, and read the conversation without an account.",
  keywords: [
    "asocialmedia",
    "global feed",
    "trending",
    "social feed",
    "open source social media",
  ],
  openGraph: {
    description:
      "Browse the global feed on asocialmedia — a cozy, open source social platform. See what's trending and join the conversation.",
    siteName: siteConfig.name,
    title: siteConfig.name,
    type: "website",
  },
  // No explicit title: the root layout's default (`%s` template) already
  // brands the home page without doubling it.
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
            url: `${siteConfig.url}/posts/${post.id}`,
          })),
          name: "Latest eddies on asocialmedia",
          numberOfItems: recentPosts.length,
        }
      : null;

  return (
    <>
      {itemListJsonLd ? <JsonLd data={itemListJsonLd} /> : null}
      <ClientHome userData={userData} />
      {/* Visually hidden but present in raw HTML for crawlers / no-JS.
          No ugly visible block - other agent owns the SSR feed visuals. */}
      <div className="sr-only" aria-hidden={false}>
        <nav aria-label="Latest eddies">
          <ul>
            {recentPosts.map((post) => (
              <li key={post.id}>
                <a href={`/posts/${post.id}`} tabIndex={-1}>
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
                <a href={`/posts/${p.id}`}>{p.content || p.id}</a>
              </span>
            ))}
          </p>
        </div>
      </noscript>
    </>
  );
}
