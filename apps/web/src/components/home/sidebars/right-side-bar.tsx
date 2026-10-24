"use client";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/shell/auth-prompt-card";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import SearchField from "@/components/layouts/navigation/search-field";
import SidebarFooterLinks from "@/components/layouts/shell/sidebar-footer-links";
import PostHistoryCard from "@/components/posts/views/post-history-card";
import { WhoToFollowSuggestions } from "@/components/recommendations/who-to-follow-suggestions";

export default function RightSideBar() {
  const { user } = useSession();
  return (
    <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-visible border-l px-2.5 pt-2.5 pb-6 xl:flex">
      <div className="shrink-0 pb-4">
        <SearchField />
      </div>
      <div className="hide-native-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto">
        <TrendingTopics />
        <WhoToFollowSuggestions key={user?.id ?? "guest"} />
        {user ? (
          <PostHistoryCard />
        ) : (
          <AuthPromptCard
            description="Create an account to unlock the full asocialmedia experience."
            imageSize={72}
            title="Get your account"
          />
        )}
        <SidebarFooterLinks />
      </div>
    </aside>
  );
}
