import { Hash } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import SecondaryRightSideBar from "@/components/layouts/secondary-right-side-bar";
import HashtagFeed from "@/components/posts/hashtag-feed";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

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
    description: `Posts tagged with #${tag}`,
    title: `#${tag} posts`,
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
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto">
          <div className="px-4 py-6">
            <div className="border-border bg-card flex items-center gap-2 rounded-xl border p-4">
              <Hash className="text-primary h-6 w-6 shrink-0" />
              <h1 className="text-xl font-semibold">#{tag}</h1>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-sm">
                posts
              </span>
            </div>
            <div className="mt-5">
              <HashtagFeed tag={tag} />
            </div>
          </div>
        </div>
      </div>

      <SecondaryRightSideBar />
    </div>
  );
}
