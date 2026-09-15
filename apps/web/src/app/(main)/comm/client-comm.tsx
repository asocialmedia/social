"use client";

import { COMMUNITY_TOPICS } from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import bannerAsm from "@assets/banner-asm.png";
import { Plus, Search, X } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import CommunityCard from "@/components/communities/community-card";
import CreateCommunityDialog from "@/components/communities/create-community-dialog";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { communityAccentStyle } from "@/lib/communities/accent";
import { useCommunitiesQuery } from "@/lib/communities/client";
import { cn } from "@/lib/utils";

// Discovery page. The banner hero carries the search field over a feathered
// image edge (no hard seam into the page), then the rails: joined communities,
// topic filters, and the browsable grid.
export default function ClientComm() {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const { goToLogin } = useRequireAuth();
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const query = useCommunitiesQuery({
    q: search.trim(),
    topic: topic ?? undefined,
  });
  const list = query.data;

  const joinedIds = useMemo(
    () => new Set((list?.joined ?? []).map((c) => c.id)),
    [list?.joined]
  );

  const handleCreate = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    setIsCreateOpen(true);
  }, [goToLogin, isLoggedIn]);

  const isSearching = search.trim().length > 0;
  const communities = list?.communities ?? [];

  let heading = "Discover communities";
  if (isSearching) {
    heading = `Results for “${search.trim()}”`;
  } else if (topic) {
    const label =
      COMMUNITY_TOPICS.find((t) => t.key === topic)?.label ?? "topic";
    heading = `Communities in ${label}`;
  }

  let listBody: React.ReactNode;
  if (query.isLoading) {
    listBody = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            className="border-border/60 h-40 animate-pulse rounded-2xl border bg-[hsl(var(--background))]"
            key={index}
          />
        ))}
      </div>
    );
  } else if (communities.length > 0) {
    listBody = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {communities.map((community) => (
          <CommunityCard
            community={community}
            joined={joinedIds.has(community.id)}
            key={community.id}
            stats={list?.stats[community.id]}
          />
        ))}
      </div>
    );
  } else {
    listBody = (
      <div
        className="border-border/60 flex flex-col items-center gap-3 rounded-2xl border px-6 py-12 text-center"
        style={communityAccentStyle("slate")}
      >
        <p className="text-foreground text-sm font-medium">
          {isSearching
            ? "No communities match that"
            : "No communities here yet"}
        </p>
        <p className="text-muted-foreground max-w-xs text-xs">
          {isSearching
            ? "Try a different search, or start the community you were looking for."
            : "Be the first to plant a flag in this topic."}
        </p>
        <Button onClick={handleCreate} size="sm" variant="outline">
          <Plus className="size-4" />
          Create community
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-3xl">
        <MobileTopBar />
        <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto pb-16 lg:pb-0">
          {/* Hero: the banner is masked into the page surface on every edge so
              there is no hard line where the image stops. */}
          <section className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <Image
                alt=""
                className="h-full w-full object-cover opacity-[0.28] dark:opacity-[0.22]"
                fill
                priority
                sizes="100vw"
                src={bannerAsm}
                style={{
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 26%, #000 62%, transparent 100%)",
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 26%, #000 62%, transparent 100%)",
                }}
              />
            </div>

            <div className="relative px-5 pt-10 pb-8 sm:pt-14">
              <h1 className="text-foreground text-2xl font-bold sm:text-3xl">
                Find your people
              </h1>
              <p className="text-muted-foreground mt-1.5 max-w-md text-sm">
                Communities are topic-scoped spaces to post, talk, and follow
                what you love on asocialmedia.
              </p>

              <div className="relative mt-5 max-w-xl">
                <Search className="text-muted-foreground absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
                <Input
                  aria-label="Search communities"
                  autoComplete="off"
                  className="h-12 pr-10 pl-10 text-sm"
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search communities"
                  value={search}
                />
                {search ? (
                  <button
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 transition-colors"
                    onClick={() => setSearch("")}
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={handleCreate} size="sm">
                  <Plus className="size-4" />
                  Create community
                </Button>
                {isLoggedIn ? (
                  <span className="text-muted-foreground text-xs">
                    Or explore what already exists below.
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Sign in to join and post.
                  </span>
                )}
              </div>
            </div>
          </section>

          <div className="px-5 pb-10">
            {!isSearching && (list?.joined?.length ?? 0) > 0 ? (
              <section className="mb-8">
                <h2 className="text-foreground mb-3 text-sm font-semibold">
                  Your communities
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {list?.joined.map((community) => (
                    <CommunityCard
                      community={community}
                      joined
                      key={community.id}
                      stats={list.stats[community.id]}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {!isSearching && (
              <section className="mb-8">
                <h2 className="text-foreground mb-3 text-sm font-semibold">
                  Browse by topic
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {COMMUNITY_TOPICS.map((t) => {
                    const isActive = topic === t.key;
                    return (
                      <button
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                          isActive
                            ? "border-primary/60 bg-primary/10 text-foreground"
                            : "border-border/60 hover:bg-muted/50 text-muted-foreground"
                        )}
                        key={t.key}
                        onClick={() => setTopic(isActive ? null : t.key)}
                        type="button"
                      >
                        <span aria-hidden="true">{t.emoji}</span>
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-foreground text-sm font-semibold">
                  {heading}
                </h2>
                {query.isFetching ? (
                  <span className="text-muted-foreground text-xs">
                    Loading…
                  </span>
                ) : null}
              </div>
              {listBody}
            </section>
          </div>
        </div>
      </div>

      <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col gap-4 overflow-visible border-l px-3 pt-3 pb-6 xl:flex">
        <SearchField />
        <div className="border-border/60 rounded-2xl border p-4">
          <p className="text-foreground text-sm font-semibold">
            Start a community
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Bring people together around the thing you cannot stop talking
            about.
          </p>
          <Button
            className="mt-3 w-full"
            onClick={handleCreate}
            size="sm"
            variant="outline"
          >
            <Plus className="size-4" />
            Create community
          </Button>
        </div>
      </aside>

      <MobileBottomNav />
      <CreateCommunityDialog
        onOpenChange={setIsCreateOpen}
        open={isCreateOpen}
      />
    </>
  );
}
