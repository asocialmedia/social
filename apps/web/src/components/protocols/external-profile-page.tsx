"use client";

import { useSearchParams } from "next/navigation";

import ClientProfile from "@/app/(main)/users/[username]/client-profile";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import ProfileSkeleton from "@/components/layouts/skeletons/profile-skeleton";
import { externalAuthorView } from "@/lib/posts/presentation";

import { useBlueskyProfile } from "./use-bluesky-profile";

export function ExternalProfilePage() {
  const actor = useSearchParams().get("actor") ?? "";
  const query = useBlueskyProfile(actor);
  if (query.isPending) {
    return <ProfileSkeleton />;
  }
  if (!query.data) {
    return (
      <main className="mx-auto flex flex-1 items-center justify-center">
        <FeedErrorState
          message="Couldn't load this Bluesky profile."
          isRetrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </main>
    );
  }
  return (
    <>
      {query.isError ? (
        <FeedErrorState
          compact
          message="Couldn't refresh this Bluesky profile. Showing cached details."
          isRetrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      <ClientProfile
        key={query.data.id}
        communityRoles={[]}
        loggedInUserData={null}
        userData={externalAuthorView(query.data)}
        external={query.data}
      />
    </>
  );
}
