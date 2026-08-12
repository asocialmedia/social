import { Hash } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NavigationCard from "@/components/home/sidebars/left/navigation-card";
import ProfileCard from "@/components/home/sidebars/right/profile-card";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import StickyFooter from "@/components/layouts/stinky-footer";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";
import SearchResults from "../../search/search-result";

interface PageProps {
  params: Promise<{ tag: string }>;
}

function safeDecodeTag(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const tag = safeDecodeTag(params.tag);
  return {
    title: `#${tag} posts`,
    description: `Posts tagged with #${tag}`,
  };
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const tag = safeDecodeTag(params.tag);
  if (!tag.trim()) {
    notFound();
  }
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
          {userData ? (
            <div className="mt-auto mb-4">
              <ProfileCard userData={userData} />
            </div>
          ) : null}
        </div>
      </aside>

      <div className="mt-5 mr-4 mb-14 ml-4 w-full min-w-0 space-y-5 md:mr-0 md:mb-0 md:ml-0">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4">
          <Hash className="h-6 w-6 shrink-0 text-primary" />
          <h1 className="font-semibold text-xl">#{tag}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-sm">
            posts
          </span>
        </div>
        <SearchResults query={`#${tag}`} />
      </div>

      <div className="sticky top-21 hidden h-fit w-80 flex-none lg:block">
        <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
          <h2 className="font-bold text-xl">#{tag}</h2>
          <p className="text-muted-foreground">Posts tagged with #{tag}</p>
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
