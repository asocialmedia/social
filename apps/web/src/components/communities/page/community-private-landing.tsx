"use client";

import type { getCommunityPreview } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/app/(main)/session-provider";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";

import CommunityPostsWorkspace from "./community-posts-workspace";

type Preview = NonNullable<Awaited<ReturnType<typeof getCommunityPreview>>>;

export default function CommunityPrivateLanding({
  initialPreview,
  viewerId,
}: {
  initialPreview: Preview;
  viewerId: string;
}) {
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { slug } = initialPreview.community;
  const query = useQuery({
    initialData: (user?.id ?? "") === viewerId ? initialPreview : undefined,
    queryFn: async () => {
      const response = await fetch(`/api/communities/${slug}/preview`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Couldn't refresh your membership");
      }
      return response.json() as Promise<Preview>;
    },
    queryKey: ["community-preview", slug, user?.id ?? ""],
    refetchInterval: (state) =>
      state.state.data?.membership?.status === "PENDING" ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const preview = query.data;
  useEffect(() => {
    if (preview?.permissions.canReadContent) {
      router.refresh();
    }
  }, [preview?.permissions.canReadContent, router]);

  const updateRequest = useMutation({
    mutationFn: async (cancel: boolean) => {
      const response = await fetch(
        `/api/communities/${slug}/membership${cancel ? "?pending=1" : ""}`,
        {
          method: cancel ? "DELETE" : "POST",
        }
      );
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "Couldn't update your request");
      }
    },
    onSuccess: async () => {
      await query.refetch();
      await client.invalidateQueries({ queryKey: ["community", slug] });
      await client.invalidateQueries({ queryKey: ["community-joined"] });
    },
  });
  const busy = updateRequest.isPending;
  const error = updateRequest.error?.message;
  let requestLabel = user ? "Request to join" : "Sign in to request access";
  if (busy) {
    requestLabel = "Sending…";
  }

  const { community } = initialPreview;
  const pending = preview?.membership?.status === "PENDING";
  const banned = preview?.permissions.banned;
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col bg-[hsl(var(--background-alt))]">
      <MobileTopBar />
      <CommunityPostsWorkspace
        community={community}
        membership={preview?.membership ?? null}
        members={community.memberCount}
        subscribed={false}
        canReadContent={false}
      >
        <>
          <div className="px-4 pt-4 sm:px-6">
            <p className="max-w-2xl text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
              {community.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {community.topics?.map((topic) => (
                <span className="text-muted-foreground text-xs" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
          </div>
          <section
            className="border-border/60 mx-4 mt-6 border-t py-8 sm:mx-6"
            aria-labelledby="community-members-only"
          >
            <LockKeyhole
              className="text-muted-foreground mb-3 size-5"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold" id="community-members-only">
              Posts are for members of this community.
            </h2>
            <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
              Request to join. Once the owner or a moderator approves your
              request, you can view posts and join community chat.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {banned ? (
                <p className="text-muted-foreground text-sm">
                  You cannot request access to this community.
                </p>
              ) : null}
              {!banned && pending ? (
                <>
                  <output className="text-sm font-medium">
                    Request pending
                  </output>
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => updateRequest.mutate(true)}
                  >
                    Cancel request
                  </Button>
                </>
              ) : null}
              {!banned && !pending ? (
                <Button
                  className="min-h-11"
                  variant="premium"
                  disabled={busy || (Boolean(user) && !preview)}
                  onClick={() => {
                    if (user) {
                      updateRequest.mutate(false);
                    } else {
                      goToLogin();
                    }
                  }}
                >
                  {requestLabel}
                </Button>
              ) : null}
            </div>
            {pending ? (
              <p className="text-muted-foreground mt-2 text-sm">
                Your request is awaiting review. You can leave this page and
                check back later.
              </p>
            ) : null}
            {error || query.isError ? (
              <p role="alert" className="text-destructive mt-3 text-sm">
                {error ||
                  "Couldn't refresh your membership. Reopen this page to try again."}
              </p>
            ) : null}
          </section>
        </>
      </CommunityPostsWorkspace>
      <MobileBottomNav />
    </div>
  );
}
