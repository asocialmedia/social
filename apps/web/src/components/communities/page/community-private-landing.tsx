"use client";

import type { getCommunityPreview } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Card } from "@asm/ui/shadui/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Loader2, LockKeyhole } from "lucide-react";
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
  let accessDescription =
    "Join to read posts and take part in community chat. The owner or a moderator reviews each request.";
  if (banned) {
    accessDescription = "You cannot request access to this community.";
  } else if (pending) {
    accessDescription =
      "The owner or a moderator will review your request. Once approved, you can read posts and join community chat.";
  }
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
        <div className="max-w-xl px-4 pt-2 pb-6 sm:px-6 sm:pt-4">
          <section
            aria-labelledby="community-members-only"
            aria-busy={busy}
            className="min-w-0"
          >
            <Card className="rounded-2xl! p-5 sm:p-6">
              <div className="text-muted-foreground mb-4 flex items-center gap-2.5 text-xs font-medium">
                <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
                  <LockKeyhole className="size-4" aria-hidden="true" />
                </span>
                Members only
              </div>
              <h2
                className="max-w-sm text-lg leading-snug font-semibold text-pretty"
                id="community-members-only"
              >
                Posts are for members of this community.
              </h2>
              <p
                className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty"
                id="community-access-description"
              >
                {accessDescription}
              </p>
              {banned ? null : (
                <div className="mt-5">
                  {pending ? (
                    <div className="space-y-3">
                      <output className="bg-muted flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium sm:w-fit">
                        <Clock3 aria-hidden="true" className="size-4" />
                        Request pending
                      </output>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        We’ll notify you when there’s a decision. You can leave
                        this page while you wait.
                      </p>
                      <Button
                        variant="ghost"
                        className="min-h-11 w-full rounded-full sm:w-auto"
                        disabled={busy}
                        onClick={() => updateRequest.mutate(true)}
                      >
                        {busy ? "Cancelling…" : "Cancel request"}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      aria-describedby="community-access-description"
                      className="min-h-11 w-full sm:w-auto"
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
                      {busy ? (
                        <Loader2
                          aria-hidden="true"
                          className="animate-spin motion-reduce:animate-none"
                        />
                      ) : null}
                      {requestLabel}
                    </Button>
                  )}
                </div>
              )}
              {error || query.isError ? (
                <div className="mt-3">
                  <p
                    role="alert"
                    className="text-destructive text-sm leading-relaxed"
                  >
                    {error || "Couldn't refresh your membership. Try again."}
                  </p>
                  {query.isError ? (
                    <Button
                      variant="ghost"
                      className="mt-2 min-h-11 w-full rounded-full sm:w-auto"
                      disabled={query.isFetching}
                      onClick={async () => {
                        await query.refetch();
                      }}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </section>
        </div>
      </CommunityPostsWorkspace>
      <MobileBottomNav />
    </div>
  );
}
