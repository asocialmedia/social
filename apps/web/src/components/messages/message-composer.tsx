"use client";

import type { MessagePage } from "@asm/db";
import type { InfiniteData } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, MessageSquareQuote, X } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { toast } from "@/lib/gooey-toast";
import {
  MessagesApiError,
  appendMessageToLastPage,
  ensureConversationKeys,
  sendEncryptedMessage,
  sendTypingIndicator,
} from "@/lib/messages/client";
import type { ConversationDetailResponse } from "@/lib/messages/client";

interface MessageComposerProps {
  conversation: ConversationDetailResponse;
  onReplyCancel: () => void;
  onSent: () => void;
  replyTarget: {
    content?: string;
    id: string;
    senderId: string;
    senderName?: string;
  } | null;
}

export function MessageComposer({
  conversation,
  onReplyCancel,
  onSent,
  replyTarget,
}: MessageComposerProps) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastTypingRef = useRef(0);

  const peer = useMemo(
    () =>
      conversation.conversation.members.find(
        (member) => member.userId !== user?.id
      ),
    [conversation.conversation.members, user?.id]
  );

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending || !user || !privateKey || !peer) {
      return;
    }

    setSending(true);
    try {
      // Unwrap the root key (cached per conversation). This also heals any
      // missing wrapped key rows from a conversation created before this
      // device had keys.
      const rootKey = await ensureConversationKeys(
        conversation.conversation,
        privateKey,
        user.id
      );
      if (!rootKey) {
        toast({
          description: "Message keys aren't ready yet",
          title: "Can't send",
          variant: "destructive",
        });
        return;
      }

      // Next ratchet index = max(server count at fetch, own messages loaded).
      const ownCacheCount = (
        queryClient.getQueryData<{
          pages: { messages: { senderId: string }[] }[];
        }>(["messages", conversation.conversation.id])?.pages ?? []
      )
        .flatMap((page) => page.messages)
        .filter((message) => message.senderId === user.id).length;

      const ratchetIndex = Math.max(conversation.mySentCount, ownCacheCount);

      const payload = replyTarget
        ? {
            content,
            replyToId: replyTarget.id,
            replyToSenderId: replyTarget.senderId,
            type: "text" as const,
          }
        : { content, type: "text" as const };

      const sent = await sendEncryptedMessage(
        conversation.conversation.id,
        rootKey,
        user.id,
        ratchetIndex,
        payload
      );

      // Fold the sent message into the cache (deduped against the SSE echo
      // of the same message) and clear the input.
      queryClient.setQueryData(
        ["messages", conversation.conversation.id],
        (old: unknown) => {
          if (!old) {
            return old;
          }
          const data = old as InfiniteData<MessagePage, string | undefined>;
          const nextPages = appendMessageToLastPage(data.pages, sent);
          return nextPages ? { ...data, pages: nextPages } : old;
        }
      );
      setText("");
      onReplyCancel();
      onSent();
      void queryClient.invalidateQueries({
        queryKey: ["message-conversations", user.id],
      });
      // ensureConversationKeys may have just created the wrapped keys (first
      // message in a new conversation). Refetch the detail so the thread can
      // unwrap and decrypt this message instead of showing it unreadable.
      void queryClient.invalidateQueries({
        queryKey: ["message-conversation", conversation.conversation.id],
      });
    } catch (error) {
      if (error instanceof MessagesApiError && error.status === 409) {
        toast({
          description:
            "Your message count changed, refresh the thread and try again",
          title: "Message not sent",
          variant: "destructive",
        });
      } else {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't send message",
          title: "Message not sent",
          variant: "destructive",
        });
      }
    } finally {
      setSending(false);
    }
  }, [
    conversation.conversation,
    conversation.mySentCount,
    onReplyCancel,
    onSent,
    peer,
    privateKey,
    queryClient,
    replyTarget,
    sending,
    text,
    user,
  ]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-border/60 border-t px-4 py-3">
      {replyTarget ? (
        <div className="border-border/60 bg-muted/40 mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs">
          <MessageSquareQuote className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Replying to </span>
            <span className="font-medium">
              {replyTarget.senderName ??
                (replyTarget.senderId === user?.id
                  ? "yourself"
                  : (peer?.user.displayName ?? "them"))}
            </span>
            {replyTarget.content ? (
              <span className="text-muted-foreground block truncate">
                {replyTarget.content}
              </span>
            ) : null}
          </div>
          <button
            aria-label="Cancel reply"
            className="icon-btn-3d ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            onClick={onReplyCancel}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="reels-input flex items-center gap-2 rounded-2xl! px-3 py-2">
        <textarea
          aria-label="Message"
          className="placeholder:text-muted-foreground max-h-32 min-h-10 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
          disabled={sending}
          onChange={(event) => {
            const { value } = event.target;
            setText(value);
            if (value.trim().length > 0) {
              // Typing indicators are throttled to one heartbeat per 3s; the
              // peer's client auto-clears after a timeout.
              const now = Date.now();
              if (now - lastTypingRef.current >= 3000) {
                lastTypingRef.current = now;
                void sendTypingIndicator(conversation.conversation.id);
              }
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${peer?.user.displayName ?? "them"}…`}
          rows={1}
          value={text}
        />
        <button
          aria-label="Send message"
          className="follow-btn-3d flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          disabled={sending || text.trim().length === 0}
          onClick={() => {
            void handleSend();
          }}
          type="button"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
