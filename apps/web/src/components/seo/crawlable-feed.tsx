import { siteConfig } from "@asm/ui/meta/site";
import Link from "next/link";

import type { CrawlPost } from "@/lib/server-feed";

interface CrawlableFeedProps {
  posts: CrawlPost[];
  title?: string;
  viewAllHref?: string;
  // When true, links point to /gusts?id=..., otherwise /posts/...
  gust?: boolean;
  description?: string;
}

// Server component: renders a crawlable list of post links in the initial HTML.
// Googlebot sees real <a href="/posts/..."> without executing JS, restoring the
// site's internal link graph. The section is visible (not hidden) so it carries
// normal link equity, but styled subtly so it doesn't compete with the interactive
// client feed for logged-in users.
export function CrawlableFeed({
  description,
  gust = false,
  posts,
  title = "Latest eddies",
  viewAllHref,
}: CrawlableFeedProps) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={title}
      className="border-border/60 border-t bg-[hsl(var(--background-alt))]"
    >
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {viewAllHref ? (
            <Link
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              href={viewAllHref}
            >
              View all
            </Link>
          ) : null}
        </div>
        {description ? (
          <p className="text-muted-foreground mb-3 text-xs">{description}</p>
        ) : null}
        <nav aria-label={`${title} navigation`}>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {posts.map((post) => {
              const href = gust ? `/gusts?id=${post.id}` : `/posts/${post.id}`;
              const absoluteHref = gust
                ? `${siteConfig.url}/gusts?id=${post.id}`
                : `${siteConfig.url}/posts/${post.id}`;
              // microdata: each link is a SocialMediaPosting entry so crawlers
              // can enrich the internal graph without needing LD+JSON.
              return (
                <li
                  key={post.id}
                  itemScope
                  itemType="https://schema.org/SocialMediaPosting"
                >
                  <Link
                    className="group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-[hsl(var(--muted))]"
                    href={href}
                    itemProp="url"
                  >
                    <span className="bg-primary/10 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
                      {post.aura}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground mr-1.5 text-xs">
                        @{post.username}
                      </span>
                      <span
                        className="group-hover:text-foreground"
                        itemProp="headline"
                      >
                        {post.content || "View post"}
                      </span>
                    </span>
                  </Link>
                  <meta content={post.displayName} itemProp="author" />
                  <meta content={absoluteHref} itemProp="mainEntityOfPage" />
                  <meta
                    content={post.createdAt.toISOString()}
                    itemProp="datePublished"
                  />
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="text-muted-foreground mt-3 text-[11px]">
          Recent posts are listed for search engines and quick navigation.
        </p>
      </div>
    </section>
  );
}

// Compact inline variant for sidebars / profile sections - single column.
export function CrawlableList({
  posts,
  title,
  gust = false,
}: {
  gust?: boolean;
  posts: CrawlPost[];
  title: string;
}) {
  if (posts.length === 0) {
    return null;
  }
  return (
    <section aria-label={title} className="px-3 py-3">
      <h3 className="mb-2 text-xs font-semibold tracking-wide">{title}</h3>
      <ul className="space-y-1">
        {posts.map((post) => (
          <li key={post.id}>
            <Link
              className="text-muted-foreground hover:text-foreground block truncate text-xs underline-offset-4 hover:underline"
              href={gust ? `/gusts?id=${post.id}` : `/posts/${post.id}`}
            >
              @{post.username}: {post.content || "View post"}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
