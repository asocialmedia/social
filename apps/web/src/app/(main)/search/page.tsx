import { Search } from "lucide-react";
import type { Metadata } from "next";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import SearchField from "@/components/layouts/search-field";
import SecondaryRightSideBar from "@/components/layouts/secondary-right-side-bar";
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

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden">
          <div className="px-4 py-6">
            {q ? (
              <SearchResults query={q} />
            ) : (
              <div className="flex flex-col items-center rounded-xl border border-border bg-card p-8 text-center">
                <Search className="mx-auto h-12 w-12 text-muted-foreground" />
                <h1 className="mt-4 font-semibold text-xl">Search</h1>
                <p className="mt-2 text-muted-foreground">
                  Start typing to search posts, people, and tags.
                </p>
                <div className="mx-auto mt-6 w-full max-w-md">
                  <SearchField />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <SecondaryRightSideBar />
    </div>
  );
}
