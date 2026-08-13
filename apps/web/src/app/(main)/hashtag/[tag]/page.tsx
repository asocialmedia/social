import { Hash } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import SecondaryRightSideBar from "@/components/layouts/secondary-right-side-bar";
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

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden">
          <div className="px-4 py-6">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4">
              <Hash className="h-6 w-6 shrink-0 text-primary" />
              <h1 className="font-semibold text-xl">#{tag}</h1>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-sm">
                posts
              </span>
            </div>
            <div className="mt-5">
              <SearchResults query={`#${tag}`} />
            </div>
          </div>
        </div>
      </div>

      <SecondaryRightSideBar />
    </div>
  );
}
