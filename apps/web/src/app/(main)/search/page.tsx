import { Search } from "lucide-react";
import type { Metadata } from "next";
import Friends from "@/components/home/sidebars/left/friends";
import NavigationCard from "@/components/home/sidebars/left/navigation-card";
import ProfileCard from "@/components/home/sidebars/right/profile-card";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import SearchField from "@/components/layouts/search-field";
import StickyFooter from "@/components/layouts/stinky-footer";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";
import SearchResults from "./search-result";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const searchParams = await props.searchParams;
  return {
    title: searchParams.q ? `Search results for ${searchParams.q}` : "Search",
    description: searchParams.q
      ? `Search results for ${searchParams.q}`
      : "Search posts, people, and tags.",
  };
}

export default async function Page(props: PageProps) {
  const searchParams = await props.searchParams;
  const q = searchParams.q?.trim() ?? "";
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  return (
    <main className="flex w-full min-w-0 gap-5">
      <aside className="sticky top-20 ml-1 hidden h-[calc(100vh-5.25rem)] w-72 shrink-0 md:block">
        <div className="flex h-full flex-col">
          <NavigationCard
            className="flex-none"
            isCollapsed={false}
            stickyTop="5rem"
          />
          <div className="mt-2 flex-none">
            <Friends isCollapsed={false} />
          </div>
          {userData ? (
            <div className="mt-auto mb-4">
              <ProfileCard userData={userData} />
            </div>
          ) : null}
        </div>
      </aside>

      <div className="mt-5 mr-4 mb-14 ml-4 w-full min-w-0 space-y-5 md:mr-0 md:mb-0 md:ml-0">
        {q ? (
          <SearchResults query={q} />
        ) : (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Search className="mx-auto h-12 w-12 text-muted-foreground" />
            <h1 className="mt-4 font-semibold text-xl">Search</h1>
            <p className="mt-2 text-muted-foreground">
              Start typing to search posts, people, and tags.
            </p>
            <div className="mx-auto mt-6 max-w-md">
              <SearchField />
            </div>
          </div>
        )}
      </div>

      <div className="sticky top-[5.25rem] hidden h-fit w-80 flex-none lg:block">
        <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
          <h2 className="font-bold text-xl">Search</h2>
          <p className="text-muted-foreground">
            {q ? `Search results for "${q}"` : "Start a search to see results"}
          </p>
        </div>
        <div className="mt-2 mb-2">
          <TrendingTopics />
        </div>

        <div className="mt-4">
          <StickyFooter />
        </div>
      </div>
    </main>
  );
}
