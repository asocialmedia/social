"use client";

import { Button } from "@asm/ui/shadui/button";
import { useSearchParams } from "next/navigation";

import ClientProfile from "@/app/(main)/users/[username]/client-profile";
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
        <Button
          variant="ghost"
          onClick={() => {
            void query.refetch();
          }}
        >
          Couldn't load profile. Retry
        </Button>
      </main>
    );
  }
  return (
    <ClientProfile
      key={query.data.id}
      communityRoles={[]}
      loggedInUserData={null}
      userData={externalAuthorView(query.data)}
      external={query.data}
    />
  );
}
