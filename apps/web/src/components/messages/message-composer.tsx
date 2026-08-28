"use client";

import type { MessagePage } from "@asm/db";
import type { InfiniteData } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Clapperboard,
  ImagePlus,
  Loader2,
  MessageSquareQuote,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import KlipyGifPicker from "@/components/comments/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/klipy-gif-picker";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { toast } from "@/lib/gooey-toast";
import {
  MessagesApiError,
  appendMessageToLastPage,
  ensureConversationKeys,
  sendEncryptedMessage,
  sendTypingIndicator,
  uploadMessageMedia,
} from "@/lib/messages/client";
import type {
  ConversationDetailResponse,
  MessageMediaUpload,
} from "@/lib/messages/client";
import type { MessagePayload } from "@/lib/messages/crypto";
import { cn } from "@/lib/utils";

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

// Sends one encrypted message and retries once at the server-provided index
// when a concurrent send raced us into a 409 mismatch. React Compiler cannot
// lower a rethrow from a catch nested inside another try, so this lives in a
// plain module-scoped helper.
async function sendWithRatchetRetry(
  conversationId: string,
  rootKey: Uint8Array,
  senderId: string,
  nextIndex: number,
  payload: MessagePayload
): Promise<Awaited<ReturnType<typeof sendEncryptedMessage>>> {
  try {
    return await sendEncryptedMessage(
      conversationId,
      rootKey,
      senderId,
      nextIndex,
      payload
    );
  } catch (error) {
    if (
      error instanceof MessagesApiError &&
      error.status === 409 &&
      typeof error.expectedIndex === "number"
    ) {
      return await sendEncryptedMessage(
        conversationId,
        rootKey,
        senderId,
        error.expectedIndex,
        payload
      );
    }
    throw error;
  }
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
  const [sendingMedia, setSendingMedia] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 24), 140);
    textarea.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- text intentionally triggers a height re-measure on every keystroke
  }, [text, adjustTextareaHeight]);

  const peer = useMemo(
    () =>
      conversation.conversation.members.find(
        (member) => member.userId !== user?.id
      ),
    [conversation.conversation.members, user?.id]
  );

  // Unwrap the root key, encrypt, post, and fold the sent message into the
  // cache. Shared by text, image, and GIF sends so every message type uses the
  // same ratchet-index and dedupe rules.
  const sendPayload = useCallback(
    async (
      payload: MessagePayload,
      options?: { preserveInput?: boolean }
    ): Promise<boolean> => {
      if (!user || !privateKey || !peer) {
        return false;
      }
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
          return false;
        }

        // Next ratchet index = max(server count at fetch, own messages loaded).
        const ownCacheCount = (
          queryClient.getQueryData<{
            pages: { messages: { senderId: string }[] }[];
          }>(["messages", conversation.conversation.id])?.pages ?? []
        )
          .flatMap((page) => page.messages)
          .filter((message) => message.senderId === user.id).length;

        const computedIndex = Math.max(conversation.mySentCount, ownCacheCount);

        // A concurrent send can still race us; sendWithRatchetRetry retries
        // once at the server's authoritative index when that happens.
        const sent = await sendWithRatchetRetry(
          conversation.conversation.id,
          rootKey,
          user.id,
          computedIndex,
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
        if (!options?.preserveInput) {
          setText("");
          onReplyCancel();
        }
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
        return true;
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't send message",
          title: "Message not sent",
          variant: "destructive",
        });
        return false;
      }
    },
    [
      conversation.conversation,
      conversation.mySentCount,
      onReplyCancel,
      onSent,
      peer,
      privateKey,
      queryClient,
      user,
    ]
  );

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending || !user || !privateKey || !peer) {
      return;
    }

    setSending(true);
    try {
      const payload = replyTarget
        ? {
            content,
            replyToId: replyTarget.id,
            replyToSenderId: replyTarget.senderId,
            type: "text" as const,
          }
        : { content, type: "text" as const };
      await sendPayload(payload);
    } catch (error) {
      // Reset before rethrowing so the sending flag clears on the failure
      // path too (replaces the previous `finally` clause).
      setSending(false);
      throw error;
    }
    setSending(false);
  }, [peer, privateKey, replyTarget, sendPayload, sending, text, user]);

  const handleSendMedia = useCallback(
    async (media: MessageMediaUpload) => {
      if (sendingMedia || sending) {
        return;
      }
      setSendingMedia(true);
      try {
        await sendPayload(
          {
            height: media.height ?? undefined,
            kind: media.kind,
            type: "media",
            url: media.url,
            width: media.width ?? undefined,
          },
          // Media is its own message; keep any typed draft and active reply.
          { preserveInput: true }
        );
      } catch (error) {
        // Reset before rethrowing so the flag clears on the failure path too
        // (replaces the previous `finally` clause).
        setSendingMedia(false);
        throw error;
      }
      setSendingMedia(false);
    },
    [sendPayload, sending, sendingMedia]
  );

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
        toast({
          description: "Messages support images and GIFs only.",
          title: "Unsupported File",
          variant: "destructive",
        });
        return;
      }
      try {
        const media = await uploadMessageMedia(file, "image");
        await handleSendMedia(media);
      } catch {
        toast({
          description: "Couldn't upload that image, try again?",
          title: "Upload Failed",
          variant: "destructive",
        });
      }
    },
    [handleSendMedia]
  );

  const handleGifSelect = useCallback(
    async (gif: KlipyGif) => {
      setGifPickerOpen(false);
      try {
        const blob = await fetch(gif.url).then((response) => {
          if (!response.ok) {
            throw new Error("Failed to fetch GIF");
          }
          return response.blob();
        });
        const file = new File([blob], `${gif.slug || "gif"}.gif`, {
          type: "image/gif",
        });
        const media = await uploadMessageMedia(file, "gif");
        await handleSendMedia(media);
      } catch {
        toast({
          description: "Couldn't add that GIF, try another?",
          title: "GIF Failed",
          variant: "destructive",
        });
      }
    },
    [handleSendMedia]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // While an IME composition is in flight the Enter key confirms the
      // candidate, not the message; only send on a bare Enter.
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const busy = sending || sendingMedia;

  return (
    <div className="border-border/60 shrink-0 border-t px-4 py-3">
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

      {gifPickerOpen ? (
        <div className="apple-panel mb-2 w-full rounded-2xl p-2">
          <KlipyGifPicker
            disabled={busy}
            onSelect={(gif) => {
              void handleGifSelect(gif);
            }}
          />
        </div>
      ) : null}

      <div className="reels-input flex items-center gap-2 rounded-2xl! px-3 py-2">
        <input
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void handleFileSelected(event);
          }}
          ref={fileInputRef}
          type="file"
        />
        <textarea
          aria-label="Message"
          className="placeholder:text-muted-foreground max-h-32 min-h-10 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
          disabled={busy}
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
          ref={textareaRef}
          rows={1}
          value={text}
        />
        <button
          aria-label="Send image"
          className={cn(
            "bg-muted/70 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:translate-y-px",
            "hover:bg-linear-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:brightness-110",
            busy && "opacity-50"
          )}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <ImagePlus className="size-4" />
        </button>
        <button
          aria-label="Search and add a GIF"
          className={cn(
            "bg-muted/70 text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:translate-y-px",
            gifPickerOpen
              ? "bg-linear-to-b from-[#7c5cff] to-[#5a3ae0] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
              : "hover:bg-linear-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:brightness-110",
            busy && "opacity-50"
          )}
          disabled={busy}
          onClick={() => setGifPickerOpen((prev) => !prev)}
          type="button"
        >
          <Clapperboard className="size-4" />
        </button>
        <button
          aria-label="Send message"
          className="follow-btn-3d flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          disabled={busy || text.trim().length === 0}
          onClick={() => {
            void handleSend();
          }}
          type="button"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
