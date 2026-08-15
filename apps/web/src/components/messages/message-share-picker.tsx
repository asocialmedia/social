"use client";

import { Button } from "@asm/ui/shadui/button";
import { Lock, Search, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { toast } from "@/lib/gooey-toast";
import {
  createConversation,
  ensureConversationKeys,
  searchMessageUsers,
  sendEncryptedMessage,
} from "@/lib/messages/client";
import type { SearchUserResult } from "@/lib/messages/client";

interface MessageSharePickerProps {
  postId?: string;
}

export function MessageSharePicker({ postId }: MessageSharePickerProps) {
  const { user } = useSession();
  const { privateKey, status } = useMessagesIdentity();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length === 0) {
      // Deferred so the effect body never calls setState synchronously.
      const timer = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(timer);
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
  }, [query]);

  const handleShare = useCallback(
    async (recipient: SearchUserResult) => {
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
        await sendEncryptedMessage(conversation.id, rootKey, user.id, 0, {
          postId,
          type: "post",
        });
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

      <div className="flex max-h-56 flex-col overflow-y-auto">
        {renderResults()}
      </div>
    </div>
  );

  function renderResults() {
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
        disabled={sendingTo === result.id}
        key={result.id}
        onClick={() => {
          void handleShare(result);
        }}
        type="button"
      >
        <UserAvatar avatarUrl={result.avatarUrl} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {result.displayName}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            @{result.username}
          </span>
        </span>
        {sendingTo === result.id ? (
          <span className="border-primary h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
        ) : (
          <Send className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
      </button>
    ));
  }
}
