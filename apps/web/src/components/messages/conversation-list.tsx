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

  // "New message" requests arrive via a custom event (from the active friends
  // rail on the right).
  const handleNewConversationRequest = useCallback(
    async (userId: string) => {
      try {
        setCreating(userId);
        const { conversation } = await createConversation(userId);
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
  // effect body never calls setState synchronously.
  useEffect(() => {
    if (!searchOpen || query.trim().length === 0) {
      const clearTimer = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(clearTimer);
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchMessageUsers(query.trim()));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
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
      try {
        setCreating(recipient.id);
        const { conversation } = await createConversation(recipient.id);
        refetchList();
        setSearchOpen(false);
        setQuery("");
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

  return (
    <div className="relative flex w-16 shrink-0 flex-col border-r border-[hsl(var(--border))]">
      {/* Discord-style icon rail: no header, just the search trigger. */}
      <div className="border-border/60 flex h-14 shrink-0 items-center justify-center border-b">
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

      <div className="hide-native-scrollbar flex flex-1 flex-col items-center gap-1.5 overflow-y-auto p-2">
        {renderConversations()}
      </div>

      {searchOpen ? (
        <div className="apple-panel absolute top-16 left-full z-50 ml-2 w-72 overflow-hidden rounded-2xl p-2 shadow-none">
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
      ) : null}
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
        <MessageCircle className="text-muted-foreground/40 mt-6 h-6 w-6" />
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
            "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors",
            active
              ? "border-border/60 bg-primary/15 border shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]"
              : "pill-3d-hover"
          )}
          key={item.conversation.id}
          onClick={() => onSelect(item.conversation.id)}
          title={peer?.displayName ?? "Conversation"}
          type="button"
        >
          <div className="relative">
            <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={38} />
            {presence?.status ? (
              <span
                className={cn(
                  "absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-[hsl(var(--background-alt))] shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.2)]",
                  presence.status === "online" ? "bg-green-500" : "bg-amber-500"
                )}
              />
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
}
