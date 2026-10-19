"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  APPLE_CARD_CLASS,
  ROW_HOVER_CLASS,
} from "@/components/home/sidebars/right/sidebar-styles";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { useDiscoverySuggestions } from "@/hooks/use-discovery-suggestions";
import type { DiscoverySuggestions } from "@/lib/recommendations/suggestion-types";
import { suggestionAccountKey } from "@/lib/recommendations/suggestion-types";
import { cn } from "@/lib/utils";

import { SuggestedFollowButton } from "./suggested-follow-button";

export function WhoToFollowSuggestions() {
  const { user } = useSession();
  const client = useQueryClient();
  const suggestions = useDiscoverySuggestions(Boolean(user));
  const [dismissals, setDismissals] = useState<{
    profileId: string;
    ids: Set<string>;
  }>({ ids: new Set(), profileId: "" });
  const profileId = suggestions.data?.profileId ?? "";
  const dismissed =
    dismissals.profileId === profileId ? dismissals.ids : new Set<string>();
  const visible = (suggestions.data?.accounts ?? [])
    .filter((account) => !dismissed.has(suggestionAccountKey(account)))
    .slice(0, 4);
  return (
    <div className={APPLE_CARD_CLASS}>
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
        <UserRound className="text-muted-foreground size-4" />
        <h2 className="flex-1 text-sm font-semibold">Who to follow</h2>
        {user ? (
          <button
            type="button"
            aria-label="Refresh suggestions"
            disabled={suggestions.isFetching}
            className="pill-3d-hover text-muted-foreground flex size-7 items-center justify-center rounded-full disabled:opacity-50"
            onClick={() => {
              setDismissals({ ids: new Set(), profileId });
              void suggestions.refetch();
            }}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                suggestions.isFetching && "animate-spin"
              )}
            />
          </button>
        ) : null}
      </div>
      {user ? null : (
        <p className="text-muted-foreground px-3 py-2 text-sm">
          Sign in to see suggestions for people to follow.
        </p>
      )}
      {user && suggestions.isPending
        ? [0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3 px-2.5 py-3">
              <div className="bg-muted size-9 animate-pulse rounded-xl" />
              <div className="bg-muted mt-2 h-3 w-32 animate-pulse rounded" />
            </div>
          ))
        : null}
      {user && suggestions.isError && !suggestions.data ? (
        <p className="text-muted-foreground px-3 py-3 text-xs">
          Suggestions are temporarily unavailable. Use refresh to retry.
        </p>
      ) : null}
      {visible.map((account) => (
        <div
          key={suggestionAccountKey(account)}
          className={cn("group rounded-xl p-2.5", ROW_HOVER_CLASS)}
        >
          <div className="flex items-center gap-2.5">
            <Link
              href={account.href}
              className="flex min-w-0 flex-1 items-center gap-2.5"
            >
              <UserAvatar
                avatarUrl={account.avatarUrl}
                seed={account.id}
                className="size-9"
                size={36}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate text-sm font-medium">
                    {account.displayName}
                  </span>
                  {account.source === "bluesky" ? (
                    <BlueskyIcon tooltip={false} className="size-3 shrink-0" />
                  ) : null}
                </span>
                <span className="text-muted-foreground block truncate text-xs group-hover:text-inherit">
                  @{account.handle}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label={`Dismiss ${account.displayName}`}
              className="text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full opacity-70 group-hover:text-inherit"
              onClick={async () => {
                setDismissals((current) => ({
                  ids: new Set([
                    ...(current.profileId === profileId ? current.ids : []),
                    suggestionAccountKey(account),
                  ]),
                  profileId,
                }));
                client.setQueriesData<DiscoverySuggestions>(
                  { queryKey: ["discovery-suggestions", user?.id ?? "guest"] },
                  (value) =>
                    value
                      ? {
                          ...value,
                          accounts: value.accounts.filter(
                            (candidate) =>
                              suggestionAccountKey(candidate) !==
                              suggestionAccountKey(account)
                          ),
                        }
                      : value
                );
                try {
                  await fetch("/api/recommendations/suggestions", {
                    body: JSON.stringify({
                      id: account.id,
                      source: account.source,
                    }),
                    headers: { "content-type": "application/json" },
                    method: "POST",
                  });
                } catch {
                  // The local dismissal remains usable while the server is unavailable.
                }
              }}
            >
              <X className="size-3" />
            </button>
          </div>
          <p className="text-muted-foreground mt-2 line-clamp-2 text-[11px] leading-4 group-hover:text-inherit">
            {account.reason}
          </p>
          <div className="mt-2 flex justify-end">
            <SuggestedFollowButton account={account} className="w-auto" />
          </div>
        </div>
      ))}
      {user &&
      !suggestions.isPending &&
      !suggestions.isError &&
      !visible.length ? (
        <p className="text-muted-foreground px-3 py-3 text-xs">
          You’re caught up. Search, follow, and interact with posts to discover
          more accounts.
        </p>
      ) : null}
      {suggestions.data?.partial ? (
        <p className="text-muted-foreground px-2.5 py-1 text-[11px]">
          Some network suggestions are temporarily unavailable.
        </p>
      ) : null}
    </div>
  );
}
