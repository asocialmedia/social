"use client";

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
import UserAvatar from "@/components/layouts/user/user-avatar";
import { ConversationRow } from "@/components/messages/conversation-list-item";
import { CreateDenDialog } from "@/components/messages/create-den-dialog";
import { JoinDenDialog } from "@/components/messages/join-den-dialog";
import { ConversationListSkeleton } from "@/components/messages/messages-skeleton";
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
  filterConversationsByType,
} from "@/lib/messages/den-label";
import type { DenListFilter } from "@/lib/messages/den-label";
import { newConversationErrorToast } from "@/lib/messages/new-conversation-copy";
import { useMessageActivity } from "@/lib/messages/use-message-activity";
import { usePresence } from "@/lib/messages/use-presence";
import { cn } from "@/lib/utils";

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

interface ConversationListProps {
  activeConversationId: string | null;
  // Which shape the list takes. Decided by the page (see conversation-list-layout)
  // because it depends on the route and the viewport, neither of which the list
  // owns.
  layout: ConversationListLayout;
  onSelect: (conversationId: string) => void;
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
  onToggleCollapse,
}: ConversationListProps) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const onlineUsers = usePresence(true);

  const collapsed = isCollapsed ?? layout === "rail";
  const full = layout === "full" && !collapsed;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [filter, setFilter] = useState<DenListFilter>("ALL");
  const [denDialogOpen, setDenDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
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
      const timer = setTimeout(() => setQuery(""), 0);
      return () => clearTimeout(timer);
    }
  }, [collapsed, query]);

  // Dismiss search results dropdown when clicking outside the search container.
  useEffect(() => {
    if (!query) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [query]);

  // Shared create-conversation flow used by both entry points (the custom
  // "new conversation" event and the search result row): creating state,
  // createConversation, list refresh, selection, error toast, and cleanup.
  const startConversation = useCallback(
    async (recipientId: string) => {
      try {
        setCreating(recipientId);
        const { conversation } = await createConversation(recipientId);
        refetchList();
        onSelect(conversation.id);
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
    },
    [onSelect, refetchList]
  );

  // "New message" requests arrive via a custom event (from the active friends
  // rail on the right).
  const handleNewConversationRequest = useCallback(
    async (userId: string) => {
      await startConversation(userId);
    },
    [startConversation]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<{ userId?: string }>;
      if (detail?.userId) {
        setQuery("");
        void handleNewConversationRequest(detail.userId);
      }
    };
    window.addEventListener("messages:new-conversation", handler);
    return () =>
      window.removeEventListener("messages:new-conversation", handler);
  }, [handleNewConversationRequest]);

  // Debounced user search for starting a new conversation. Deferred so the
  // effect body never calls setState synchronously; stale or cleaned-up
  // requests are ignored so an out-of-order response cannot overwrite newer
  // results.
  useEffect(() => {
    if (query.trim().length === 0) {
      const clearTimer = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(clearTimer);
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      // A failed search should not leave stale results behind; `found`
      // starts empty so the catch path clears the list below.
      let found: SearchUserResult[] = [];
      try {
        found = await searchMessageUsers(query.trim());
      } catch (error) {
        console.error("Message user search failed:", error);
      }
      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

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
      await startConversation(recipient.id);
      setQuery("");
    },
    [startConversation]
  );

  // Render helpers are declared before the early JSX return so their function
  // declarations never sit in unreachable code (React Compiler cannot lower
  // hoisted declarations after a return).
  function renderSearchResults() {
    if (searching) {
      return (
        <p className="text-muted-foreground px-2 py-2 text-xs">Searching…</p>
      );
    }
    if (results.length === 0 && query.trim().length > 0) {
      return (
        <p className="text-muted-foreground px-2 py-2 text-xs">
          No one found. You can only message people you follow.
        </p>
      );
    }
    return results.map((result) => (
      <button
        className="pill-3d-hover flex items-center gap-2.5 rounded-xl px-2 py-2 text-left"
        disabled={creating === result.id}
        key={result.id}
        onClick={() => {
          void handleStartConversation(result);
        }}
        type="button"
      >
        <UserAvatar
          avatarUrl={result.avatarUrl}
          className="relative"
          size={36}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {result.displayName}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            @{result.username}
          </span>
        </span>
        {result.hasIdentity ? null : (
          <span className="text-muted-foreground bg-muted/40 rounded-full px-2 py-0.5 text-[10px]">
            no messages
          </span>
        )}
      </button>
    ));
  }

  function renderConversationList() {
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
    return visibleItems.map((item) => {
      const peer = item.conversation.members.find(
        (member) => member.userId !== myId
      )?.user;
      const presence = peer
        ? (onlineUsers.find((candidate) => candidate.id === peer.id)?.status ??
          null)
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
    });
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
          "relative flex shrink-0 flex-col overflow-x-hidden border-r border-[hsl(var(--border))] transition-[width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
          collapsed ? "w-16" : "w-full md:w-72 xl:w-80"
        )}
      >
        {/* Header row: Messages title + Sidebar toggle button */}
        <div className="border-border/60 relative flex h-14 shrink-0 items-center border-b px-4 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]">
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
        <div
          className="relative flex h-14 shrink-0 items-center px-3.5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]"
          ref={searchContainerRef}
        >
          <div className="flex w-full items-center gap-2">
            {/* Search Bar / Icon button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "relative flex h-9 items-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
                    collapsed
                      ? "icon-btn-3d w-9 justify-center rounded-full px-0"
                      : "reels-input flex-1 rounded-xl! px-3 focus-within:shadow-[0_0_0_2px_rgba(255,149,0,0.25)]"
                  )}
                >
                  <button
                    aria-label={collapsed ? "Search people" : undefined}
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center justify-center transition-colors",
                      collapsed ? "h-9 w-9 rounded-full" : "h-4 w-4"
                    )}
                    onClick={
                      collapsed
                        ? handleExpandAndFocusSearch
                        : () => searchInputRef.current?.focus()
                    }
                    type="button"
                  >
                    <Search className="text-muted-foreground h-4 w-4 shrink-0" />
                  </button>
                  <input
                    aria-label={
                      collapsed ? undefined : "Search people you follow"
                    }
                    className={cn(
                      "placeholder:text-muted-foreground bg-transparent text-sm transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] outline-none",
                      collapsed
                        ? "pointer-events-none ml-0 max-w-0 p-0 opacity-0"
                        : "ml-2 min-w-0 flex-1 opacity-100"
                    )}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setQuery("");
                        searchInputRef.current?.blur();
                      }
                    }}
                    placeholder={
                      collapsed ? undefined : "Search people you follow…"
                    }
                    ref={searchInputRef}
                    tabIndex={collapsed ? -1 : undefined}
                    value={query}
                  />
                  {query && !collapsed ? (
                    <button
                      aria-label="Clear search"
                      className="text-muted-foreground hover:text-foreground flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full"
                      onClick={() => {
                        setQuery("");
                        searchInputRef.current?.focus();
                      }}
                      type="button"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </TooltipTrigger>
              {collapsed ? (
                <TooltipContent
                  className="tooltip-3d"
                  side="right"
                  sideOffset={12}
                >
                  Search people
                </TooltipContent>
              ) : null}
            </Tooltip>

            {/* Circular join den button beside search bar */}
            <div
              className={cn(
                "shrink-0 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
                collapsed
                  ? "pointer-events-none -ml-2 max-w-0 scale-50 overflow-hidden opacity-0"
                  : "max-w-9 scale-100 opacity-100"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={collapsed ? undefined : "Join a den"}
                    className="icon-btn-3d text-foreground flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
                    onClick={() => setJoinDialogOpen(true)}
                    tabIndex={collapsed ? -1 : undefined}
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
                collapsed
                  ? "pointer-events-none -ml-2 max-w-0 scale-50 overflow-hidden opacity-0"
                  : "max-w-9 scale-100 opacity-100"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={collapsed ? undefined : "New den"}
                    className="icon-btn-3d text-foreground flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
                    onClick={() => setDenDialogOpen(true)}
                    tabIndex={collapsed ? -1 : undefined}
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

          {/* Dropdown with search results */}
          {query.trim().length > 0 && !collapsed ? (
            <div className="panel-3d absolute inset-x-2 top-[calc(100%+4px)] z-50 max-h-80 overflow-y-auto rounded-2xl p-2 shadow-2xl">
              {renderSearchResults()}
            </div>
          ) : null}
        </div>

        {/* All / DMs / Dens tabs */}
        <div
          className={cn(
            "shrink-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
            collapsed
              ? "pointer-events-none h-0 py-0 opacity-0"
              : "h-9 px-2 pt-1 pb-1 opacity-100"
          )}
        >
          <div
            aria-label={collapsed ? undefined : "Filter conversations"}
            className="flex gap-1 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]"
            role={collapsed ? undefined : "tablist"}
          >
            {DEN_LIST_FILTERS.map((option) => {
              const isSelected = filter === option;
              return (
                <button
                  aria-selected={collapsed ? undefined : isSelected}
                  className={cn(
                    "pill-3d-hover flex-1 cursor-pointer rounded-full px-2 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-border/60 bg-primary/15 border"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  key={option}
                  onClick={() => setFilter(option)}
                  role={collapsed ? undefined : "tab"}
                  tabIndex={collapsed ? -1 : undefined}
                  type="button"
                >
                  {FILTER_LABEL[option]}
                  <span className="ml-1 text-[10px] tabular-nums opacity-70">
                    {counts[option]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Conversation list */}
        <div
          className={cn(
            "hide-native-scrollbar flex flex-1 flex-col overflow-x-hidden overflow-y-auto p-2 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
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
