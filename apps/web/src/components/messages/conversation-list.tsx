"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, MessageCircle, Plus, Search, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { ConversationRow } from "@/components/messages/conversation-list-item";
import { CreateDenDialog } from "@/components/messages/create-den-dialog";
import { DenAvatarStack } from "@/components/messages/den-avatar-stack";
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
  conversationDisplayName,
  countConversationsByType,
  denMemberCountLabel,
  filterConversationsByType,
} from "@/lib/messages/den-label";
import type { DenListFilter } from "@/lib/messages/den-label";
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
}

export function ConversationList({
  activeConversationId,
  layout,
  onSelect,
}: ConversationListProps) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const onlineUsers = usePresence(true);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [filter, setFilter] = useState<DenListFilter>("ALL");
  const [denDialogOpen, setDenDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryFn: () => fetchConversationList(),
    queryKey: ["message-conversations", user?.id],
    refetchInterval: 30_000,
  });
  const items = data?.items ?? NO_ITEMS;

  // Previews are what the full list is FOR, and the rail shows none, so the rail
  // asks the decryptor for nothing rather than decrypting twenty conversations to
  // throw the text away.
  useConversationPreviewRequests(layout === "full" ? items : NO_ITEMS);

  // The rail has no room for tabs and no room for a den either, so the filter and
  // the visible set are computed for the full list only. On the rail the list is
  // a way around to whatever is already open, and the search is how you start
  // something new.
  const visibleItems = useMemo(
    () =>
      layout === "full" ? filterConversationsByType(items, filter) : items,
    [filter, items, layout]
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
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't start chat",
          title: "Can't message",
          variant: "destructive",
        });
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
        setSearchOpen(false);
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
    if (!searchOpen || query.trim().length === 0) {
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
  }, [query, searchOpen]);

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
      setSearchOpen(false);
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

  function renderSearchPopover() {
    if (!searchOpen) {
      return null;
    }
    return (
      <div
        className={cn(
          "panel-3d absolute top-16 z-50 rounded-2xl p-2",
          // The rail is 64px wide with no room to open into, so its popover sits
          // to the side of it; the full list has the width, so it opens over its
          // own rows.
          layout === "full"
            ? "inset-x-2"
            : "left-full ml-2 w-72 max-w-[calc(100vw-5.5rem)]"
        )}
      >
        <div className="reels-input flex h-9 items-center gap-2 rounded-xl! px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            autoFocus
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people you follow…"
            value={query}
          />
        </div>
        <div className="mt-2 flex max-h-80 flex-col overflow-y-auto">
          {renderSearchResults()}
        </div>
      </div>
    );
  }

  function renderFullList() {
    if (isLoading) {
      return <ConversationListSkeleton full />;
    }
    // Two different empty states, because they have two different causes and two
    // different next actions: no conversations at all is "search for somebody",
    // while an empty filtered tab is "you are on the wrong tab".
    if (visibleItems.length === 0) {
      if (items.length === 0) {
        return (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <MessageCircle className="text-muted-foreground/40 h-6 w-6" />
            <p className="text-muted-foreground text-xs leading-relaxed">
              No conversations yet. Search for someone you follow to start one,
              or make a den for a group.
            </p>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Users className="text-muted-foreground/40 h-6 w-6" />
          <p className="text-muted-foreground text-xs leading-relaxed">
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
          item={item}
          key={item.conversation.id}
          myUserId={myId}
          onSelect={onSelect}
          presence={presence}
        />
      );
    });
  }

  function renderRail() {
    if (isLoading) {
      return <ConversationListSkeleton />;
    }
    if (items.length === 0) {
      return (
        <MessageCircle className="text-muted-foreground/40 mt-6 h-6 w-6" />
      );
    }
    return items.map((item) => {
      const myId = user?.id ?? "";
      const myMember = item.conversation.members.find(
        (member) => member.userId === myId
      );
      const peer = item.conversation.members.find(
        (member) => member.userId !== myId
      )?.user;
      // Mute is this member's own preference, so the indicator is read off their
      // membership row rather than anything the peer can see.
      const muted = Boolean(myMember?.mutedAt);
      const presence = peer
        ? onlineUsers.find((u) => u.id === peer.id)
        : undefined;
      const active = item.conversation.id === activeConversationId;
      // The rail's icon has no text of its own, so the row's name has to be
      // computed here. A den gets the same heading the full list gives it, plus
      // its size, because "Study group" alone does not say how many people are in
      // the room -- and that is the one fact somebody scanning the rail wants.
      const heading = conversationDisplayName(
        {
          members: item.conversation.members.map((member) => ({
            avatarUrl: member.user.avatarUrl,
            displayName: member.user.displayName,
            id: member.userId,
            username: member.user.username,
          })),
          name: item.conversation.name,
          type: item.conversation.type,
        },
        myId
      );
      const rowName =
        item.conversation.type === "DEN"
          ? `${heading}, ${denMemberCountLabel(item.conversation.members.length)}`
          : heading;
      // Spelled out rather than nested in the JSX: a mute and an unread count are
      // two independent facts about the same row, and a muted chat carries no
      // count at all, so the unread branch wins when both are somehow present.
      const label =
        item.unreadCount > 0
          ? `${rowName}, ${item.unreadCount} unread message${item.unreadCount === 1 ? "" : "s"}`
          : `${rowName}${muted ? ", muted" : ""}`;
      return (
        <button
          aria-label={label}
          className={cn(
            "relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors",
            active
              ? "border-border/60 bg-primary/15 border shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]"
              : "hover:bg-muted/50"
          )}
          key={item.conversation.id}
          onClick={() => onSelect(item.conversation.id)}
          title={heading}
          type="button"
        >
          <div className="relative">
            {item.conversation.type === "DEN" ? (
              <DenAvatarStack
                avatarMediaId={item.conversation.avatarMediaId ?? null}
                members={item.conversation.members.map((member) => ({
                  avatarUrl: member.user.avatarUrl,
                  displayName: member.user.displayName,
                  id: member.userId,
                  role: member.role ?? null,
                  username: member.user.username,
                }))}
                myUserId={myId}
                size={38}
              />
            ) : (
              <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={38} />
            )}
            {presence?.status ? (
              <span
                className={cn(
                  "border-background absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.2)]",
                  presence.status === "online" ? "bg-green-500" : "bg-amber-500"
                )}
              />
            ) : null}
            {muted ? (
              <span className="bg-background absolute -bottom-0.5 -left-0.5 flex size-3.5 items-center justify-center rounded-full">
                <BellOff className="text-muted-foreground size-2.5" />
              </span>
            ) : null}
          </div>
          {item.unreadCount > 0 ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
              {item.unreadCount}
            </span>
          ) : null}
        </button>
      );
    });
  }

  // A phone with a conversation open shows that conversation and nothing else; the
  // thread's back button is what brings the list back.
  if (layout === "hidden") {
    return null;
  }

  const full = layout === "full";

  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-col border-r border-[hsl(var(--border))]",
        full ? "w-full md:w-72 xl:w-80" : "w-16 items-center"
      )}
    >
      {/* Discord-style icon rail: no header, just the search trigger. */}
      <div
        className={cn(
          "border-border/60 flex h-14 shrink-0 items-center gap-2 border-b",
          full ? "justify-between px-4" : "justify-center px-0"
        )}
      >
        {full ? (
          <h2 className="text-sm font-semibold tracking-tight">Messages</h2>
        ) : null}
        {/* Dens are not reachable from the search popover, which starts a DM with
            one person. This is the entry point, and it sits beside the search
            rather than inside it so the two jobs stay separate. */}
        <button
          aria-label="New den"
          className={cn(
            "icon-btn-3d flex h-9 w-9 cursor-pointer items-center justify-center rounded-full",
            full && "ml-auto"
          )}
          onClick={() => setDenDialogOpen(true)}
          title="New den"
          type="button"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          aria-label="Search people"
          className={cn(
            "icon-btn-3d flex h-9 w-9 cursor-pointer items-center justify-center rounded-full",
            searchOpen && "border-border/60 bg-primary/15 border"
          )}
          onClick={() => setSearchOpen((open) => !open)}
          type="button"
        >
          {searchOpen ? (
            <X className="h-4 w-4" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* All / DMs / Dens. A tablist rather than three buttons, so arrow-key
          navigation and the pressed state come from the role rather than from
          anything hand-rolled. Full list only: the rail has 64px. */}
      {full ? (
        <div
          aria-label="Filter conversations"
          className="flex shrink-0 gap-1 px-2 pt-2"
          role="tablist"
        >
          {DEN_LIST_FILTERS.map((option) => {
            const isSelected = filter === option;
            return (
              <button
                aria-selected={isSelected}
                className={cn(
                  "pill-3d-hover flex-1 cursor-pointer rounded-full px-2 py-1 text-xs font-medium transition-colors",
                  isSelected
                    ? "border-border/60 bg-primary/15 border"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={option}
                onClick={() => setFilter(option)}
                role="tab"
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
      ) : null}

      <div
        className={cn(
          "hide-native-scrollbar flex flex-1 flex-col overflow-y-auto",
          full ? "gap-0.5 p-2" : "items-center gap-1.5 p-2"
        )}
      >
        {full ? renderFullList() : renderRail()}
      </div>

      {renderSearchPopover()}

      {/* Mounted unconditionally rather than on first open: the dialog owns its
          draft state, and a conditional mount would throw that away every time
          the reader closes it mid-form. */}
      <CreateDenDialog
        onCreated={refetchList}
        onOpenChange={setDenDialogOpen}
        open={denDialogOpen}
      />
    </div>
  );
}
