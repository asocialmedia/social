"use client";

import { Button } from "@asm/ui/shadui/button";
import { useQuery } from "@tanstack/react-query";
import { History, Lock, Search, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { toast } from "@/lib/gooey-toast";
import {
  MessagesApiError,
  createConversation,
  ensureConversationKeys,
  fetchConversationDetail,
  fetchConversationList,
  searchMessageUsers,
  sendEncryptedMessage,
} from "@/lib/messages/client";
import type { SearchUserResult } from "@/lib/messages/client";

interface MessageSharePickerProps {
  postId?: string;
}

interface ShareRecipient {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  username: string;
}

export function MessageSharePicker({ postId }: MessageSharePickerProps) {
  const { user } = useSession();
  const { privateKey, status } = useMessagesIdentity();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  // People you already chat with, so sharing again doesn't need a search.
  const { data: conversations } = useQuery({
    enabled: Boolean(user),
    queryFn: () => fetchConversationList(),
    queryKey: ["message-share-recents", user?.id],
  });

  const recentRecipients = useMemo((): ShareRecipient[] => {
    if (!user || !conversations) {
      return [];
    }
    return conversations.items
      .map((item) => {
        const peer = item.conversation.members.find(
          (member) => member.userId !== user.id
        )?.user;
        if (!peer) {
          return null;
        }
        return {
          avatarUrl: peer.avatarUrl,
          displayName: peer.displayName,
          id: peer.id,
          username: peer.username,
        };
      })
      .filter((recipient): recipient is ShareRecipient => recipient !== null)
      .slice(0, 5);
  }, [conversations, user]);

  useEffect(() => {
    if (query.trim().length === 0) {
      // Deferred so the effect body never calls setState synchronously.
      const timer = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(timer);
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
        // A failed search should not leave stale results behind.
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
  }, [query]);

  const handleShare = useCallback(
    async (recipient: ShareRecipient) => {
      if (!user || !privateKey || !postId) {
        return;
      }
      setSendingTo(recipient.id);
      try {
        const { conversation } = await createConversation(recipient.id);
        const rootKey = await ensureConversationKeys(
          conversation,
          privateKey,
          user.id
        );
        if (!rootKey) {
          throw new Error("Couldn't prepare conversation keys");
        }
        // The ratchet index must equal the number of messages this sender
        // already has in the conversation (the server rejects mismatches with
        // 409). Fetch the current count instead of assuming a fresh thread.
        const { mySentCount } = await fetchConversationDetail(conversation.id);
        try {
          await sendEncryptedMessage(
            conversation.id,
            rootKey,
            user.id,
            mySentCount,
            { postId, type: "post" }
          );
        } catch (error) {
          // A concurrent send can still race us; retry with the server's
          // authoritative index when it reports the mismatch.
          if (
            error instanceof MessagesApiError &&
            error.status === 409 &&
            typeof error.expectedIndex === "number"
          ) {
            await sendEncryptedMessage(
              conversation.id,
              rootKey,
              user.id,
              error.expectedIndex,
              { postId, type: "post" }
            );
          } else {
            throw error;
          }
        }
        toast({
          description: `Sent to ${recipient.displayName}`,
          title: "Message sent",
        });
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't send message",
          title: "Can't share",
          variant: "destructive",
        });
      } finally {
        setSendingTo(null);
      }
    },
    [postId, privateKey, user]
  );

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  if (status !== "ready" || !privateKey) {
    return (
      <div className="flex flex-col items-center gap-2.5 py-4 text-center">
        <Lock className="text-muted-foreground h-6 w-6" />
        <p className="text-muted-foreground max-w-56 text-sm">
          Messages are end-to-end encrypted and set up automatically. Open
          Messages once to get started.
        </p>
        <Button
          asChild
          className="h-8 rounded-full px-4 text-xs"
          variant="premium"
        >
          <Link href="/messages">Open Messages</Link>
        </Button>
      </div>
    );
  }

  const isSearching = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="reels-input flex h-9 items-center gap-2 px-3">
        <Search className="text-muted-foreground h-4 w-4 shrink-0" />
        <input
          autoFocus
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people you follow…"
          value={query}
        />
      </div>

      <div className="flex max-h-64 flex-col overflow-y-auto">
        {isSearching ? renderSearchResults() : renderRecentRecipients()}
      </div>
    </div>
  );

  function renderSearchResults() {
    if (searching) {
      return (
        <p className="text-muted-foreground px-2 py-2 text-xs">Searching…</p>
      );
    }
    if (results.length === 0) {
      return (
        <p className="text-muted-foreground px-2 py-2 text-xs">
          No one found. You can only message people you follow.
        </p>
      );
    }
    return results.map((result) => (
      <RecipientRow
        disabled={sendingTo === result.id}
        key={result.id}
        onSelect={() => {
          void handleShare({
            avatarUrl: result.avatarUrl,
            displayName: result.displayName,
            id: result.id,
            username: result.username,
          });
        }}
        recipient={{
          avatarUrl: result.avatarUrl,
          displayName: result.displayName,
          id: result.id,
          username: result.username,
        }}
        sending={sendingTo === result.id}
      />
    ));
  }

  function renderRecentRecipients() {
    if (recentRecipients.length === 0) {
      return (
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <History className="text-muted-foreground/50 h-6 w-6" />
          <p className="text-muted-foreground max-w-56 px-2 text-xs">
            No conversations yet. Search for someone you follow to send your
            first message.
          </p>
        </div>
      );
    }
    return (
      <>
        <p className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase">
          <History className="h-3 w-3" />
          Recent
        </p>
        {recentRecipients.map((recipient) => (
          <RecipientRow
            disabled={sendingTo === recipient.id}
            key={recipient.id}
            onSelect={() => {
              void handleShare(recipient);
            }}
            recipient={recipient}
            sending={sendingTo === recipient.id}
          />
        ))}
      </>
    );
  }
}

function RecipientRow({
  disabled,
  onSelect,
  recipient,
  sending,
}: {
  disabled: boolean;
  onSelect: () => void;
  recipient: ShareRecipient;
  sending: boolean;
}) {
  return (
    <button
      className="pill-3d-hover flex items-center gap-2.5 rounded-xl px-2 py-2 text-left"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <UserAvatar avatarUrl={recipient.avatarUrl} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {recipient.displayName}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          @{recipient.username}
        </span>
      </span>
      {sending ? (
        <span className="border-primary h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
      ) : (
        <Send className="text-muted-foreground h-4 w-4 shrink-0" />
      )}
    </button>
  );
}
