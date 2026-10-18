import Link from "next/link";

import { communityAccentStyle } from "@/lib/communities/accent";
import { cn } from "@/lib/utils";

interface CommunitySectionNavProps {
  active: "chat" | "posts";
  accentColor: string;
  channelId?: string;
  slug: string;
}

export default function CommunitySectionNav({
  active,
  accentColor,
  channelId,
  slug,
}: CommunitySectionNavProps) {
  const links = [
    { href: `/a/${slug}`, key: "posts" as const, label: "Posts" },
    {
      href: channelId ? `/a/${slug}/chat/${channelId}` : `/a/${slug}/chat`,
      key: "chat" as const,
      label: "Chat",
    },
  ];

  return (
    <nav
      aria-label={`${slug} community sections`}
      className="border-border/60 flex h-12 items-stretch gap-1 border-b px-3"
      style={communityAccentStyle(accentColor)}
    >
      {links.map((link) => (
        <Link
          aria-current={active === link.key ? "page" : undefined}
          className={cn(
            "relative flex min-w-20 items-center justify-center rounded-t-lg px-3 text-sm font-semibold transition-colors",
            active === link.key
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
          href={link.href}
          key={link.key}
        >
          {link.label}
          {active === link.key ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--community-accent)]"
            />
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
