"use client";

import { normalizeMessageSearchQuery } from "@asm/messages/search";
import { Input } from "@asm/ui/shadui/input";
import { Tabs, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { ConversationRow } from "@/components/messages/conversation-list-item";
import { CreateDenDialog } from "@/components/messages/create-den-dialog";
import { JoinDenDialog } from "@/components/messages/join-den-dialog";
import { ConversationListSkeleton } from "@/components/messages/messages-skeleton";
import { OnlineFriendsStrip } from "@/components/messages/online-friends-strip";
import { toast } from "@/lib/gooey-toast";
import {
  createConversation,
  fetchConversationList,
  searchMessageUsers,
} from "@/lib/messages/client";
import type { SearchUserResult } from "@/lib/messages/client";
import type { ConversationListLayout } from "@/lib/messages/conversation-list-layout";
import {
  DEN_LIST_FILTERS,
  countConversationsByType,
  countUnreadConversationsByType,
  filterConversationsByType,
  isDenListFilter,
} from "@/lib/messages/den-label";
import type { DenListFilter } from "@/lib/messages/den-label";
import {
  clearGlobalMessageSearchViewState,
  saveGlobalMessageSearchViewState,
  peekGlobalMessageSearchViewState,
} from "@/lib/messages/global-message-search-view-state";
import { newConversationErrorToast } from "@/lib/messages/new-conversation-copy";
import { MessageSearchRequestError } from "@/lib/messages/search-request";
import { focusSearchResult } from "@/lib/messages/search-result-navigation";
import { useGlobalMessageSearch } from "@/lib/messages/use-global-message-search";
import type { GlobalMessageSearchResult } from "@/lib/messages/use-global-message-search";
import { useMessageActivity } from "@/lib/messages/use-message-activity";
import { usePresence } from "@/lib/messages/use-presence";
import { cn } from "@/lib/utils";

import { GlobalMessageSearchResults } from "./global-message-search-results";
import { MessagesErrorState } from "./messages-error-state";
import { useConversationPreviewRequests } from "./use-conversation-preview-requests";

// A stable empty array, so the rail's call into the preview hook does not look
// like a new list on every render.
const NO_ITEMS: never[] = [];

// The All / DMs / Dens tabs, as data rather than as JSX, so the pressed state, the
// label and the count can never disagree about which one they are.
const FILTER_LABEL: Record<DenListFilter, string> = {
  ALL: "All",
  DEN: "Dens",
  DM: "DMs",
};

function filterTabsAriaLabel(
  collapsed: boolean,
  hasSearchQuery: boolean
): string | undefined {
  if (collapsed) {
    return undefined;
  }
  return hasSearchQuery ? "Filter message results" : "Filter conversations";
}

function filterTabAriaLabel(
  filter: DenListFilter,
  hasSearchQuery: boolean,
  conversationCount: number,
  unreadCount: number
): string {
  if (hasSearchQuery) {
    return `${FILTER_LABEL[filter]} message results`;
  }
  const unreadLabel = unreadCount > 0 ? ", unread messages" : "";
  return `${FILTER_LABEL[filter]}, ${conversationCount} conversations${unreadLabel}`;
}

type ProfileSearchState = (
  | {
      attempt: number;
      query: string;
      results: SearchUserResult[];
      status: "idle";
    }
  | {
      attempt: number;
      query: string;
      results: [];
      status: "loading" | "error";
    }
  | {
      attempt: number;
      query: string;
      results: SearchUserResult[];
      status: "success";
    }
) & { error?: string; retryAt?: number; userId?: string };

function currentProfileSearchState(
  state: ProfileSearchState,
  query: string,
  attempt: number,
  composing: boolean,
  userId: string | undefined
): ProfileSearchState {
  if (!query || composing || !userId) {
    return { attempt, query, results: [], status: "idle" };
  }
  if (
    state.query === query &&
    state.attempt === attempt &&
    state.userId === userId
  ) {
    return state;
  }
  return { attempt, query, results: [], status: "loading" };
}

interface ConversationListProps {
  activeConversationId: string | null;
  // Which shape the list takes. Decided by the page (see conversation-list-layout)
  // because it depends on the route and the viewport, neither of which the list
  // owns.
  layout: ConversationListLayout;
  onSelect: (conversationId: string) => void;
  onSelectMessage: (conversationId: string, messageId: string) => void;
  // Whether the sidebar is currently collapsed into rail mode.
  isCollapsed?: boolean;
  // Toggle the collapsed/expanded state.
  onToggleCollapse?: () => void;
  // Explicitly expand the sidebar.
  onExpand?: () => void;
}

export function ConversationList({
  activeConversationId,
  isCollapsed,
  layout,
  onExpand,
  onSelect,
  onSelectMessage,
  onToggleCollapse,
}: ConversationListProps) {
  const { user } = useSession();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const onlineUsers = usePresence(true);
  const presenceByUserId = useMemo(
    () => new Map(onlineUsers.map((person) => [person.id, person.status])),
    [onlineUsers]
  );

  const collapsed = isCollapsed ?? layout === "rail";
  const full = layout === "full" && !collapsed;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const globalSearchResultsRef = useRef<HTMLDivElement>(null);
  const [restoredSearchView, setRestoredSearchView] = useState(() =>
    layout === "hidden" || !user?.id
      ? null
      : peekGlobalMessageSearchViewState(user.id)
  );
  const globalSearchScrollTop = useRef(restoredSearchView?.scrollTop ?? 0);
  const [restoreGlobalSearchScrollTop, setRestoreGlobalSearchScrollTop] =
    useState(restoredSearchView?.scrollTop ?? 0);
  const [selectedSearchMessageId, setSelectedSearchMessageId] = useState<
    string | null
  >(restoredSearchView?.selectedMessageId ?? null);

  const [query, setQuery] = useState(restoredSearchView?.query ?? "");
  const [isComposing, setIsComposing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [profileSearch, setProfileSearch] = useState<ProfileSearchState>({
    attempt: 0,
    query: "",
    results: [],
    status: "idle",
  });
  const [profileSearchAttempt, setProfileSearchAttempt] = useState(0);
  const [profilesExpanded, setProfilesExpanded] = useState(
    restoredSearchView?.profilesExpanded ?? false
  );
  const [creating, setCreating] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const [filter, setFilter] = useState<DenListFilter>(
    restoredSearchView?.conversationType ?? "ALL"
  );
  const [denDialogOpen, setDenDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const globalSearch = useGlobalMessageSearch({
    conversationType: filter,
    enabled: !isComposing,
    query,
    visible: layout !== "hidden",
  });
  const profileQuery = query.trim();
  const hasSearchQuery = profileQuery.length > 0;
  const currentProfileSearch = currentProfileSearchState(
    profileSearch,
    profileQuery,
    profileSearchAttempt,
    isComposing,
    userId
  );
  const searchInputLabel = collapsed
    ? undefined
    : "Search profiles and messages";
  const searchInputPlaceholder = collapsed ? undefined : "Search…";
  const { loadMore: loadGlobalSearchMore } = globalSearch;
  const handleGlobalSearchRetry = globalSearch.retry;
  const handleFailedPageRetry =
    globalSearch.results.length > 0 && globalSearch.hasMore
      ? globalSearch.loadMore
      : globalSearch.retry;
  const handleGlobalSearchLoadMore = useCallback(async () => {
    await loadGlobalSearchMore();
  }, [loadGlobalSearchMore]);
  const resetGlobalSearchPosition = useCallback(() => {
    globalSearchScrollTop.current = 0;
    setRestoreGlobalSearchScrollTop(0);
    setSelectedSearchMessageId(null);
  }, []);
  const handleSearchQueryChange = useCallback(
    (value: string) => {
      setRestoredSearchView(null);
      setProfilesExpanded(false);
      if (user?.id) {
        clearGlobalMessageSearchViewState(user.id);
      }
      resetGlobalSearchPosition();
      setQuery(value);
    },
    [resetGlobalSearchPosition, user]
  );
  const handleClearSearch = useCallback(() => {
    handleSearchQueryChange("");
  }, [handleSearchQueryChange]);
  const handleGlobalSearchScroll = useCallback((scrollTop: number) => {
    globalSearchScrollTop.current = scrollTop;
  }, []);
  const profileRetryAt = currentProfileSearch.retryAt ?? 0;
  const handleProfileRetry = useCallback(() => {
    if (profileRetryAt > Date.now()) {
      return;
    }
    setProfileSearchAttempt((attempt) => attempt + 1);
  }, [profileRetryAt]);
  const handleProfileToggleExpanded = useCallback(() => {
    setProfilesExpanded((expanded) => !expanded);
  }, []);
  const handleSearchEscape = useCallback(() => {
    handleClearSearch();
    searchInputRef.current?.focus();
  }, [handleClearSearch]);
  const handleGlobalSearchSelect = useCallback(
    (result: GlobalMessageSearchResult) => {
      setRestoreGlobalSearchScrollTop(globalSearchScrollTop.current);
      setSelectedSearchMessageId(result.hit.id);
      if (user?.id) {
        saveGlobalMessageSearchViewState(user.id, {
          conversationType: filter,
          profilesExpanded,
          query,
          scrollTop: globalSearchScrollTop.current,
          selectedMessageId: result.hit.id,
        });
      }
      onSelectMessage(result.hit.conversationId, result.hit.id);
    },
    [filter, onSelectMessage, profilesExpanded, query, user]
  );

  useEffect(() => {
    if (layout !== "hidden" && user?.id) {
      clearGlobalMessageSearchViewState(user.id);
    }
  }, [layout, user]);

  const { data, isLoading, isError } = useQuery({
    queryFn: () => fetchConversationList(),
    queryKey: ["message-conversations", user?.id],
    refetchInterval: 30_000,
  });
  const items = data?.items ?? NO_ITEMS;

  // Previews are what the full list is FOR, and the rail shows none, so the rail
  // asks the decryptor for nothing rather than decrypting twenty conversations to
  // throw the text away.
  useConversationPreviewRequests(full ? items : NO_ITEMS);

  // Filtered conversation items matching the active filter tab.
  const visibleItems = useMemo(
    () => filterConversationsByType(items, filter),
    [filter, items]
  );
  // Per-filter counts for the tab strip, from the same array the rows are rendered
  // from rather than from a second query, so a badge on a tab and the rows under it
  // are one read.
  const counts = useMemo(() => countConversationsByType(items), [items]);
  const unreadCounts = useMemo(
    () => countUnreadConversationsByType(items),
    [items]
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      if (isDenListFilter(value)) {
        resetGlobalSearchPosition();
        setFilter(value);
      }
    },
    [resetGlobalSearchPosition]
  );

  const refetchList = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["message-conversations", user?.id],
    });
  }, [queryClient, user?.id]);

  // A message arriving in ANY conversation re-reads the list, which is what moves
  // that thread to the top the moment it lands rather than on the next poll. The
  // event carries only the conversation id, so the response is to refetch: the
  // server owns the ordering (by conversation activity) and the preview, and
  // re-deriving either here would be a second implementation to keep in step.
  useMessageActivity(refetchList);

  // Clear search query if sidebar gets collapsed.
  useEffect(() => {
    if (collapsed && query) {
      const timer = setTimeout(handleClearSearch, 0);
      return () => clearTimeout(timer);
    }
  }, [collapsed, handleClearSearch, query]);

  // Shared create-conversation flow used by both entry points (the custom
  // "new conversation" event and the search result row): creating state,
  // createConversation, list refresh, selection, error toast, and cleanup.
  const startConversation = useCallback(
    async (recipientId: string) => {
      if (creatingRef.current) {
        return false;
      }
      creatingRef.current = true;
      let created = false;
      try {
        setCreating(recipientId);
        const { conversation } = await createConversation(recipientId);
        refetchList();
        onSelect(conversation.id);
        created = true;
      } catch (error) {
        // One decision, in the file that owns it: a 401 here means this device has
        // no session, and the server's body for it is the bare word "Unauthorized",
        // which is the route's shape rather than an answer. Everything the server
        // wrote for a human to read - the follow gate, the block, the missing
        // identity - is still shown verbatim.
        toast(newConversationErrorToast(error));
      }
      // The catch above never rethrows and the try body has no early returns,
      // so resetting here matches the previous `finally` semantics.
      setCreating(null);
      creatingRef.current = false;
      return created;
    },
    [onSelect, refetchList]
  );

  // "New message" requests arrive via a custom event (from the active friends
  // rail on the right).
  const handleNewConversationRequest = useCallback(
    async (recipientId: string) => {
      await startConversation(recipientId);
    },
    [startConversation]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<{ userId?: string }>;
      if (detail?.userId) {
        handleClearSearch();
        void handleNewConversationRequest(detail.userId);
      }
    };
    window.addEventListener("messages:new-conversation", handler);
    return () =>
      window.removeEventListener("messages:new-conversation", handler);
  }, [handleClearSearch, handleNewConversationRequest]);

  // Search the same query for follow-eligible profiles, cancelling stale work
  // while the message index uses its own shorter debounce and pagination.
  useEffect(() => {
    const normalizedQuery = query.trim();
    if (layout === "hidden") {
      return;
    }
    if (
      isComposing ||
      normalizedQuery.length === 0 ||
      [...normalizedQuery].length > 256 ||
      !userId
    ) {
      const clearTimer = setTimeout(
        () =>
          setProfileSearch({
            attempt: profileSearchAttempt,
            query: normalizedQuery,
            results: [],
            status: "idle",
            userId,
          }),
        0
      );
      return () => clearTimeout(clearTimer);
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setProfileSearch({
        attempt: profileSearchAttempt,
        query: normalizedQuery,
        results: [],
        status: "loading",
        userId,
      });
      try {
        const found = await searchMessageUsers(
          normalizedQuery,
          "message",
          controller.signal
        );
        if (!cancelled) {
          setProfileSearch({
            attempt: profileSearchAttempt,
            query: normalizedQuery,
            results: found,
            status: "success",
            userId,
          });
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setProfileSearch({
            attempt: profileSearchAttempt,
            error:
              error instanceof Error
                ? error.message
                : "Profiles could not be loaded.",
            query: normalizedQuery,
            results: [],
            retryAt:
              error instanceof MessageSearchRequestError ? error.retryAt : 0,
            status: "error",
            userId,
          });
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [isComposing, layout, profileSearchAttempt, query, userId]);

  // Expand the sidebar and focus the search input in one smooth action.
  const handleExpandAndFocusSearch = useCallback(() => {
    onExpand?.();
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  }, [onExpand]);

  const handleStartConversation = useCallback(
    async (recipient: SearchUserResult) => {
      if (!recipient.hasIdentity) {
        toast({
          description: `${recipient.displayName} hasn't enabled Messages yet`,
          title: "Can't message",
          variant: "destructive",
        });
        return;
      }
      const created = await startConversation(recipient.id);
      if (created) {
        handleClearSearch();
      }
    },
    [handleClearSearch, startConversation]
  );
  const handleProfileSelect = useCallback(
    (profile: SearchUserResult) => {
      void handleStartConversation(profile);
    },
    [handleStartConversation]
  );

  // Render helpers are declared before the early JSX return so their function
  // declarations never sit in unreachable code (React Compiler cannot lower
  // hoisted declarations after a return).
  function renderConversationList() {
    if (query.trim().length > 0) {
      if (isComposing) {
        return null;
      }
      if ([...query.trim()].length > 256) {
        return (
          <output className="text-muted-foreground px-3 py-4 text-sm">
            Use 256 characters or fewer to search.
          </output>
        );
      }
      return (
        <div
          className="flex min-h-0 flex-1 flex-col"
          ref={globalSearchResultsRef}
        >
          <GlobalMessageSearchResults
            coverageComplete={globalSearch.coverageComplete}
            coveragePaused={globalSearch.coveragePaused}
            creatingProfileId={creating}
            error={globalSearch.error}
            focusMessageId={selectedSearchMessageId}
            hasMore={globalSearch.hasMore}
            loading={globalSearch.loading}
            loadingMore={globalSearch.loadingMore}
            messageQueryValid={normalizeMessageSearchQuery(query).valid}
            myUserId={user?.id ?? ""}
            onEscape={handleSearchEscape}
            onLoadMore={handleGlobalSearchLoadMore}
            onProfileRetry={handleProfileRetry}
            onProfileSelect={handleProfileSelect}
            onProfileToggleExpanded={handleProfileToggleExpanded}
            onRefresh={handleGlobalSearchRetry}
            onRetry={handleFailedPageRetry}
            onScrollPositionChange={handleGlobalSearchScroll}
            onSelect={handleGlobalSearchSelect}
            profileError={currentProfileSearch.error ?? null}
            profileRetryAt={profileRetryAt}
            profileExpanded={profilesExpanded}
            profileLoading={currentProfileSearch.status === "loading"}
            profiles={
              currentProfileSearch.status === "success"
                ? currentProfileSearch.results
                : []
            }
            query={query}
            results={globalSearch.results}
            restoreScrollTop={restoreGlobalSearchScrollTop}
            retryAt={globalSearch.retryAt}
          />
        </div>
      );
    }
    if (isError && visibleItems.length === 0) {
      return <MessagesErrorState collapsed={collapsed} onRetry={refetchList} />;
    }
    if (isLoading) {
      return <ConversationListSkeleton full={!collapsed} />;
    }
    // Two different empty states, because they have two different causes and two
    // different next actions: no conversations at all is "search for somebody",
    // while an empty filtered tab is "you are on the wrong tab".
    if (visibleItems.length === 0) {
      if (items.length === 0) {
        return (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <MessageCircle className="text-muted-foreground/40 h-6 w-6 shrink-0" />
            <p
              className={cn(
                "text-muted-foreground text-xs leading-relaxed transition-opacity duration-200",
                collapsed ? "hidden" : "block"
              )}
            >
              No conversations yet. Search for someone you follow to start one,
              or make a den for a group.
            </p>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Users className="text-muted-foreground/40 h-6 w-6 shrink-0" />
          <p
            className={cn(
              "text-muted-foreground text-xs leading-relaxed transition-opacity duration-200",
              collapsed ? "hidden" : "block"
            )}
          >
            No {FILTER_LABEL[filter].toLowerCase()} yet.
          </p>
        </div>
      );
    }
    const myId = user?.id ?? "";
    return (
      <>
        {isError ? (
          <MessagesErrorState
            collapsed={collapsed}
            compact
            onRetry={refetchList}
          />
        ) : null}
        {visibleItems.map((item) => {
          const peer =
            item.conversation.type === "DM"
              ? item.conversation.members.find(
                  (member) => member.userId !== myId
                )?.user
              : undefined;
          const presence = peer
            ? (presenceByUserId.get(peer.id) ?? null)
            : null;
          return (
            <ConversationRow
              active={item.conversation.id === activeConversationId}
              collapsed={collapsed}
              item={item}
              key={item.conversation.id}
              myUserId={myId}
              onSelect={onSelect}
              presence={presence}
            />
          );
        })}
      </>
    );
  }

  // A phone with a conversation open shows that conversation and nothing else; the
  // thread's back button is what brings the list back.
  if (layout === "hidden") {
    return null;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "relative flex min-h-0 shrink-0 flex-col overflow-x-hidden border-r border-[hsl(var(--border))] transition-[width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
          collapsed ? "w-16" : "w-full md:w-72 xl:w-80"
        )}
      >
        {/* Desktop sidebar title and collapse control. */}
        <div className="border-border/60 relative hidden h-14 shrink-0 items-center border-b px-2.5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] md:flex">
          <h2
            className={cn(
              "text-base font-semibold tracking-tight whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
              collapsed
                ? "pointer-events-none max-w-0 -translate-x-3 overflow-hidden opacity-0"
                : "max-w-[200px] translate-x-0 opacity-100"
            )}
          >
            Messages
          </h2>

          <div className="absolute right-4 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className={cn(
                    "icon-btn-3d text-muted-foreground hover:text-foreground h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors",
                    collapsed ? "flex" : "hidden md:flex"
                  )}
                  onClick={onToggleCollapse}
                  type="button"
                >
                  <div className="relative flex h-4 w-4 items-center justify-center">
                    <PanelLeftClose
                      className={cn(
                        "absolute inset-0 h-4 w-4 transition-all duration-300 ease-out",
                        collapsed
                          ? "scale-75 rotate-90 opacity-0"
                          : "scale-100 rotate-0 opacity-100"
                      )}
                    />
                    <PanelLeftOpen
                      className={cn(
                        "absolute inset-0 h-4 w-4 transition-all duration-300 ease-out",
                        collapsed
                          ? "scale-100 rotate-0 opacity-100"
                          : "scale-75 -rotate-90 opacity-0"
                      )}
                    />
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="tooltip-3d"
                side={collapsed ? "right" : "bottom"}
                sideOffset={collapsed ? 12 : 8}
              >
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Search & Create Den row below the title */}
        <div className="relative flex h-14 shrink-0 items-center px-2.5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]">
          <div className="flex w-full items-center gap-2">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Search profiles and messages"
                    className="icon-btn-3d text-muted-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    onClick={handleExpandAndFocusSearch}
                    type="button"
                  >
                    <Search aria-hidden className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={12}>
                  Search profiles and messages
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2"
                />
                <Input
                  aria-controls={
                    hasSearchQuery
                      ? "unified-message-search-results"
                      : undefined
                  }
                  aria-label={searchInputLabel}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-11 w-full rounded-xl! pr-11 pl-9 text-base md:text-sm [&::-webkit-search-cancel-button]:appearance-none"
                  enterKeyHint="search"
                  maxLength={512}
                  onBlur={() => setSearchFocused(false)}
                  onChange={(event) =>
                    handleSearchQueryChange(event.target.value)
                  }
                  onCompositionEnd={(event) => {
                    handleSearchQueryChange(event.currentTarget.value);
                    setIsComposing(false);
                  }}
                  onCompositionStart={() => setIsComposing(true)}
                  onFocus={() => setSearchFocused(true)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) {
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      handleSearchEscape();
                    } else if (
                      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                      focusSearchResult(
                        globalSearchResultsRef.current,
                        event.key
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                  placeholder={searchInputPlaceholder}
                  ref={searchInputRef}
                  spellCheck={false}
                  type="search"
                  value={query}
                />
                {query ? (
                  <button
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    onClick={handleSearchEscape}
                    type="button"
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            )}

            {/* Circular join den button beside search bar */}
            <div
              className={cn(
                "shrink-0 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
                collapsed || hasSearchQuery || searchFocused
                  ? "pointer-events-none -ml-2 max-w-0 scale-50 overflow-hidden opacity-0"
                  : "max-w-11 scale-100 opacity-100"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={collapsed ? undefined : "Join a den"}
                    className="icon-btn-3d text-foreground flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
                    onClick={() => setJoinDialogOpen(true)}
                    tabIndex={
                      collapsed || hasSearchQuery || searchFocused
                        ? -1
                        : undefined
                    }
                    type="button"
                  >
                    <Ticket className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  className="tooltip-3d"
                  side="bottom"
                  sideOffset={8}
                >
                  Join a den
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Circular create den button next to search bar on right */}
            <div
              className={cn(
                "shrink-0 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
                collapsed || hasSearchQuery || searchFocused
                  ? "pointer-events-none -ml-2 max-w-0 scale-50 overflow-hidden opacity-0"
                  : "max-w-11 scale-100 opacity-100"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={collapsed ? undefined : "New den"}
                    className="icon-btn-3d text-foreground flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
                    onClick={() => setDenDialogOpen(true)}
                    tabIndex={
                      collapsed || hasSearchQuery || searchFocused
                        ? -1
                        : undefined
                    }
                    type="button"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  className="tooltip-3d"
                  side="bottom"
                  sideOffset={8}
                >
                  New den
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {full && !activeConversationId && !query ? (
          <OnlineFriendsStrip
            creating={creating}
            onSelect={(recipientId) => {
              void startConversation(recipientId);
            }}
            users={onlineUsers}
          />
        ) : null}

        {/* All / DMs / Dens filter the inbox and message results. */}
        <div
          className={cn(
            "grid shrink-0 grid-cols-1 px-1.5 transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none",
            collapsed
              ? "pointer-events-none grid-rows-[0fr] opacity-0"
              : "grid-rows-[1fr] opacity-100"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <Tabs
              className="px-1 py-1"
              onValueChange={handleFilterChange}
              value={filter}
            >
              <TabsList
                aria-label={filterTabsAriaLabel(collapsed, hasSearchQuery)}
                appearance="raised"
                className="grid h-auto min-h-11 w-full grid-cols-3 rounded-2xl!"
              >
                {DEN_LIST_FILTERS.map((option) => (
                  <TabsTrigger
                    aria-label={filterTabAriaLabel(
                      option,
                      hasSearchQuery,
                      counts[option],
                      unreadCounts[option]
                    )}
                    appearance="raised"
                    className="relative min-h-11 min-w-0 gap-2 rounded-xl px-2 text-xs sm:text-sm"
                    key={option}
                    tabIndex={collapsed ? -1 : undefined}
                    value={option}
                  >
                    {FILTER_LABEL[option]}
                    {hasSearchQuery ? null : (
                      <span
                        aria-hidden
                        className="chip-3d inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums"
                      >
                        {counts[option]}
                      </span>
                    )}
                    {!hasSearchQuery && unreadCounts[option] > 0 ? (
                      <span
                        aria-hidden
                        className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-linear-to-b from-[#ffb45c] to-[#e65500] shadow-[0_0_6px_rgba(255,149,0,0.5)]"
                      />
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Conversation list */}
        <div
          className={cn(
            "hide-native-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden p-2",
            query.trim().length > 0 ? "overflow-y-hidden" : "overflow-y-auto",
            collapsed ? "gap-1.5" : "gap-0.5"
          )}
        >
          {renderConversationList()}
        </div>

        {/* Mounted unconditionally rather than on first open: the dialog owns its
            draft state, and a conditional mount would throw that away every time
            the reader closes it mid-form. */}
        <CreateDenDialog
          onCreated={(conversationId) => {
            refetchList();
            onSelect(conversationId);
          }}
          onOpenChange={setDenDialogOpen}
          open={denDialogOpen}
        />
        <JoinDenDialog onOpenChange={setJoinDialogOpen} open={joinDialogOpen} />
      </div>
    </TooltipProvider>
  );
}
