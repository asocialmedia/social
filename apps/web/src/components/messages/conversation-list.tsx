"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { ConversationListSkeleton } from "@/components/messages/messages-skeleton";
import { toast } from "@/lib/gooey-toast";
import {
  createConversation,
  fetchConversationList,
  searchMessageUsers,
} from "@/lib/messages/client";
import type { SearchUserResult } from "@/lib/messages/client";
import { usePresence } from "@/lib/messages/use-presence";
import { cn } from "@/lib/utils";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
}

export function ConversationList({
  activeConversationId,
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

  const { data, isLoading } = useQuery({
    queryFn: () => fetchConversationList(),
    queryKey: ["message-conversations", user?.id],
    refetchInterval: 30_000,
  });

  const refetchList = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["message-conversations", user?.id],
    });
  }, [queryClient, user?.id]);

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
      } finally {
        setCreating(null);
      }
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
      try {
        const found = await searchMessageUsers(query.trim());
        if (!cancelled) {
          setResults(found);
        }
      } catch (error) {
        console.error("Message user search failed:", error);
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
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

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Header with Title and Search Button */}
      <div className="border-border/60 flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-lg font-bold tracking-tight">Messages</h1>
        <button
          aria-label="Search people"
          className={cn(
            "icon-btn-3d flex h-9 w-9 items-center justify-center rounded-full",
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

      {/* Embedded Search Input when searchOpen */}
      {searchOpen ? (
        <div className="border-border/40 bg-muted/20 border-b p-3">
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
          <div className="mt-2 flex max-h-60 flex-col overflow-y-auto">
            {renderSearchResults()}
          </div>
        </div>
      ) : null}

      {/* Conversations List */}
      <div className="hide-native-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {renderConversations()}
      </div>
    </div>
  );

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

  function renderConversations() {
    if (isLoading) {
      return <ConversationListSkeleton />;
    }
    if (!data || data.items.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="bg-muted/30 flex h-14 w-14 items-center justify-center rounded-2xl">
            <MessageCircle className="text-muted-foreground/50 h-7 w-7" />
          </div>
          <p className="text-muted-foreground mt-3 text-xs font-medium">
            No conversations yet
          </p>
          <p className="text-muted-foreground/70 mt-1 text-[11px]">
            Search to start chatting with people you follow.
          </p>
        </div>
      );
    }
    return data.items.map((item) => {
      const myId = user?.id ?? "";
      const peer = item.conversation.members.find(
        (member) => member.userId !== myId
      )?.user;
      const presence = peer
        ? onlineUsers.find((u) => u.id === peer.id)
        : undefined;
      const active = item.conversation.id === activeConversationId;
      return (
        <button
          aria-label={peer?.displayName ?? "Conversation"}
          className={cn(
            "relative flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors",
            active
              ? "border-primary/40 bg-primary/15 border shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]"
              : "hover:bg-muted/50"
          )}
          key={item.conversation.id}
          onClick={() => onSelect(item.conversation.id)}
          title={peer?.displayName ?? "Conversation"}
          type="button"
        >
          <div className="relative shrink-0">
            <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={40} />
            {presence?.status ? (
              <span
                className={cn(
                  "absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-[hsl(var(--background-alt))] shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.2)]",
                  presence.status === "online" ? "bg-green-500" : "bg-amber-500"
                )}
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-sm font-semibold">
                {peer?.displayName || peer?.username || "Chat"}
              </span>
              {item.unreadCount > 0 ? (
                <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                  {item.unreadCount}
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              @{peer?.username}
            </p>
          </div>
        </button>
      );
    });
  }
}
