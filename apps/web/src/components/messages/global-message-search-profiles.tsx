"use client";

import { ArrowDown, ChevronDown, ChevronUp } from "lucide-react";
import type { KeyboardEventHandler } from "react";

import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import UserAvatar from "@/components/layouts/user/user-avatar";
import type { SearchUserResult } from "@/lib/messages/client";

import { SearchRetryButton } from "./search-retry-button";

export const PROFILE_PREVIEW_LIMIT = 5;

interface GlobalMessageSearchProfilesProps {
  creatingId: string | null;
  error: string | null;
  expanded: boolean;
  loading: boolean;
  onRetry: () => void;
  onResultKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onSelect: (profile: SearchUserResult) => void;
  onSkipToMessages: () => void;
  onToggleExpanded: () => void;
  profiles: readonly SearchUserResult[];
  query: string;
  retryAt?: number;
}

export function getVisibleProfileSearchResults(
  profiles: readonly SearchUserResult[],
  expanded: boolean
): readonly SearchUserResult[] {
  return expanded ? profiles : profiles.slice(0, PROFILE_PREVIEW_LIMIT);
}

export function rankProfileSearchResults(
  profiles: readonly SearchUserResult[],
  query: string
): SearchUserResult[] {
  const normalizedQuery = normalizeProfileSearchText(query);
  if (!normalizedQuery) {
    return [...profiles];
  }
  return profiles
    .map((profile, index) => {
      const displayName = normalizeProfileSearchText(profile.displayName);
      const username = normalizeProfileSearchText(profile.username);
      let rank = 2;
      if (displayName === normalizedQuery || username === normalizedQuery) {
        rank = 0;
      } else if (
        displayName.startsWith(normalizedQuery) ||
        username.startsWith(normalizedQuery)
      ) {
        rank = 1;
      }
      return { index, profile, rank };
    })
    .toSorted(
      (left, right) => left.rank - right.rank || left.index - right.index
    )
    .map(({ profile }) => profile);
}

function normalizeProfileSearchText(value: string): string {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

export function GlobalMessageSearchProfiles({
  creatingId,
  error,
  expanded,
  loading,
  onRetry,
  onResultKeyDown,
  onSelect,
  onSkipToMessages,
  onToggleExpanded,
  profiles,
  query,
  retryAt,
}: GlobalMessageSearchProfilesProps) {
  const rankedProfiles = rankProfileSearchResults(profiles, query);
  const visibleProfiles = getVisibleProfileSearchResults(
    rankedProfiles,
    expanded
  );
  const remainingCount = Math.max(0, profiles.length - PROFILE_PREVIEW_LIMIT);

  function renderMatches() {
    if (loading) {
      return (
        <div aria-label="Searching profiles" className="space-y-1">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              className="flex min-h-14 animate-pulse items-center gap-2.5 rounded-xl px-2 py-2 motion-reduce:animate-none"
              key={index}
            >
              <span className="bg-muted h-10 w-10 shrink-0 rounded-[30%]" />
              <span className="min-w-0 flex-1 space-y-2">
                <span className="bg-muted block h-3 w-2/5 rounded" />
                <span className="bg-muted/70 block h-3 w-1/4 rounded" />
              </span>
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <output className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-2">
          <p className="text-muted-foreground m-0 text-xs leading-relaxed">
            {error}
          </p>
          <SearchRetryButton
            onKeyDown={onResultKeyDown}
            onRetry={onRetry}
            retryAt={retryAt}
          />
        </output>
      );
    }

    if (profiles.length === 0) {
      return (
        <p className="text-muted-foreground m-0 px-3 py-3 text-xs leading-relaxed">
          No matching profiles.
        </p>
      );
    }

    let expansionButtonContent = (
      <>
        <ChevronDown className="h-4 w-4" />
        Show {remainingCount} more profiles
      </>
    );
    if (expanded) {
      expansionButtonContent = (
        <>
          <ChevronUp className="h-4 w-4" />
          Show fewer profiles
        </>
      );
    }

    return (
      <>
        <ul
          aria-label="Profiles matching your search"
          className="m-0 list-none space-y-1 p-0"
          id="global-message-search-profiles-list"
        >
          {visibleProfiles.map((profile) => (
            <li key={profile.id}>
              <button
                aria-label={`Message ${profile.displayName}`}
                className="pill-3d-hover flex min-h-14 w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-default disabled:opacity-60"
                data-search-result
                disabled={creatingId !== null || !profile.hasIdentity}
                onClick={() => onSelect(profile)}
                onKeyDown={onResultKeyDown}
                type="button"
                title={
                  profile.hasIdentity
                    ? undefined
                    : "This profile has not enabled Messages yet"
                }
              >
                <UserAvatar
                  avatarUrl={profile.avatarUrl}
                  className="h-9 w-9 shrink-0"
                  size={36}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-5 font-medium">
                    {profile.displayName}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs leading-5">
                    @{profile.username}
                  </span>
                </span>
                {profile.hasIdentity ? null : (
                  <span className="chip-3d shrink-0 rounded-full px-2.5 py-1 text-[10px]">
                    Not on Messages
                  </span>
                )}
                {creatingId === profile.id ? (
                  <ZephLoader
                    variant="search"
                    className="text-muted-foreground h-4 w-4 shrink-0 motion-reduce:animate-none"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {remainingCount > 0 ? (
          <button
            aria-controls="global-message-search-profiles-list"
            aria-expanded={expanded}
            data-search-result
            className="text-muted-foreground hover:text-foreground mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            onClick={onToggleExpanded}
            onKeyDown={onResultKeyDown}
            type="button"
          >
            {expansionButtonContent}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="global-search-profiles-heading">
      <div className="mb-1 flex min-h-11 items-center justify-between gap-2 px-2">
        <div>
          <h3
            className="text-foreground m-0 text-sm font-semibold tracking-tight"
            id="global-search-profiles-heading"
          >
            Profiles
          </h3>
          <span className="text-muted-foreground block text-[11px] leading-5">
            People you follow
          </span>
        </div>
        {!loading && profiles.length >= PROFILE_PREVIEW_LIMIT ? (
          <button
            aria-label="Skip profiles and go to message results"
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            onClick={onSkipToMessages}
            onKeyDown={onResultKeyDown}
            type="button"
          >
            Messages <ArrowDown aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {renderMatches()}
    </section>
  );
}
