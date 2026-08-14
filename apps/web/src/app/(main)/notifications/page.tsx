import type { Metadata } from "next";
import Link from "next/link";

import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import PostHistoryCard from "@/components/posts/post-history-card";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import Notifications from "./notifications";

export const metadata: Metadata = {
  title: "Rustles",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Notifications />
      </div>

      <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
        <div className="flex flex-col gap-4">
          <PostHistoryCard />
          <TrendingTopics />
          <footer className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 px-3 pt-1 text-xs">
            <span>© {new Date().getFullYear()} Asocialmedia</span>
            {[
              { href: "/toc", label: "Terms" },
              { href: "/privacy", label: "Privacy" },
              { href: "https://x.com/parazeeknova", label: "Twitter" },
              {
                href: "https://github.com/asocialmedia/social",
                label: "Github",
              },
              { href: "/support", label: "Support" },
            ].map(({ href, label }) => (
              <Link
                className="hover:text-foreground transition-colors"
                href={href}
                key={label}
                target={href.startsWith("http") ? "_blank" : undefined}
              >
                {label}
              </Link>
            ))}
          </footer>
        </div>
      </aside>

      <MobileBottomNav />
    </div>
  );
}
