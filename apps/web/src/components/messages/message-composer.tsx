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
import dynamic from "next/dynamic";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import KlipyGifPicker from "@/components/comments/composer/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/composer/klipy-gif-picker";
import { MessageAttachmentStrip } from "@/components/messages/message-attachment-strip";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { useMessageAttachments } from "@/components/messages/use-message-attachments";
import { toast } from "@/lib/gooey-toast";
import {
  MessagesApiError,
  appendMessageToLastPage,
  ensureConversationKeys,
  fetchConversationDetail,
  sendEncryptedMessage,
  sendTypingIndicator,
} from "@/lib/messages/client";
import type { ConversationDetailResponse } from "@/lib/messages/client";
import type { MessagePayload } from "@/lib/messages/crypto";
import { cn } from "@/lib/utils";

// Cropper is heavy; only pull it in when a sender edits an image.
const MessageImageEditDialog = dynamic(
  () => import("@/components/messages/message-image-edit-dialog"),
  { ssr: false }
);

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
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  const conversationId = conversation.conversation.id;

  const {
    addFiles,
    attachments,
    canSend,
    isUploading,
    readyGroups,
    removeAttachment,
    removeAttachments,
    replaceAttachmentFile,
    retryAttachment,
  } = useMessageAttachments(conversationId);

  const editingAttachment = attachments.find(
    (attachment) => attachment.id === editingId
  );

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
        // device had keys. The refresh callback guards the rotate path: if our
        // cached detail is stale (the peer rotated or reset), refetch it before
        // minting a new epoch so we never wrap for a superseded peer key.
        const rootKey = await ensureConversationKeys(
          conversation.conversation,
          privateKey,
          user.id,
          {
            refreshConversation: async () => {
              try {
                const fresh = await fetchConversationDetail(
                  conversation.conversation.id
                );
                queryClient.setQueryData(
                  ["message-conversation", conversation.conversation.id],
                  fresh
                );
                return fresh.conversation;
              } catch {
                return null;
              }
            },
          }
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
    if (sending) {
      return;
    }
    if (attachments.length === 0 && !content) {
      return;
    }
    // Attachments must all be uploaded and READY before any goes out: the
    // serving route gates on that status, so a premature send would hand the
    // peer a 404.
    if (attachments.length > 0 && !canSend) {
      return;
    }
    if (!user || !privateKey || !peer) {
      return;
    }

    setSending(true);
    try {
      if (readyGroups.length > 0) {
        let first = true;
        for (const group of readyGroups) {
          const payload: MessagePayload = {
            content: first && content ? content : undefined,
            images: group.images,
            kind: group.kind,
            type: "media",
            ...(first && replyTarget
              ? {
                  replyToId: replyTarget.id,
                  replyToSenderId: replyTarget.senderId,
                }
              : {}),
          };
          // oxlint-disable-next-line no-await-in-loop -- album groups share one ratchet sequence, so they must be encrypted and sent in order.
          const ok = await sendPayload(payload);
          if (!ok) {
            // Leave the failed group and any unsent ones staged and tracked so
            // the sender can retry and their media rows are still reclaimed if
            // they leave the thread. Groups already sent above stay removed.
            setSending(false);
            return;
          }
          // Only drop groups that actually landed, and never discard their media
          // (now referenced by sent messages). Earlier groups stay dropped so a
          // later failure cannot cause a resend.
          removeAttachments(group.attachmentIds, { discard: false });
          first = false;
        }
      } else {
        const payload = replyTarget
          ? {
              content,
              replyToId: replyTarget.id,
              replyToSenderId: replyTarget.senderId,
              type: "text" as const,
            }
          : { content, type: "text" as const };
        const ok = await sendPayload(payload);
        if (!ok) {
          setSending(false);
          return;
        }
      }
    } catch {
      // sendPayload surfaces its own failures via toast; just release the flag
      // so the composer stays usable.
      setSending(false);
      return;
    }
    // Clear the sending flag BEFORE focusing: the textarea is disabled while
    // `busy`, and a disabled element cannot receive focus, so focusing first
    // was a no-op. The frame callback then runs after React has re-enabled
    // it, so the caret actually lands. preventScroll keeps the just-scrolled
    // transcript from being yanked by the browser focusing the composer.
    setSending(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }, [
    attachments.length,
    canSend,
    peer,
    privateKey,
    readyGroups,
    removeAttachments,
    replyTarget,
    sendPayload,
    sending,
    text,
    user,
  ]);

  const handleFilesSelected = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? [...files] : [];
      if (list.length > 0) {
        addFiles(list);
      }
    },
    [addFiles]
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFilesSelected(event.target.files);
      event.target.value = "";
    },
    [handleFilesSelected]
  );

  const handleGifSelect = useCallback(
    async (gif: KlipyGif) => {
      setGifPickerOpen(false);
      try {
        const response = await fetch(gif.url);
        if (!response.ok) {
          toast({
            description: "Couldn't add that GIF, try another?",
            title: "GIF Failed",
            variant: "destructive",
          });
          return;
        }
        const blob = await response.blob();
        const file = new File([blob], `${gif.slug || "gif"}.gif`, {
          type: "image/gif",
        });
        addFiles([file]);
      } catch {
        toast({
          description: "Couldn't add that GIF, try another?",
          title: "GIF Failed",
          variant: "destructive",
        });
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      setDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Ignore leaves that stay inside the composer (fired when moving between
    // child elements), so the highlight does not flicker.
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      handleFilesSelected(event.dataTransfer.files);
    },
    [handleFilesSelected]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const { files } = event.clipboardData ?? {};
      if (files && files.length > 0) {
        event.preventDefault();
        handleFilesSelected(files);
      }
    },
    [handleFilesSelected]
  );

  const handleEditAttachment = useCallback((id: string) => {
    setEditingId(id);
  }, []);

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

  const busy = sending;
  // Send is allowed with a caption, an album, or both; an album must be fully
  // uploaded (and error-free) before it goes out.
  const sendDisabled =
    busy ||
    isUploading ||
    (attachments.length > 0 ? !canSend : text.trim().length === 0);

  return (
    <div
      className={cn(
        "border-border/60 shrink-0 border-t px-4 py-3 transition-colors",
        dragActive && "bg-[#ff9500]/5"
      )}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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
        <div className="panel-3d mb-2 w-full rounded-2xl p-2">
          <KlipyGifPicker
            disabled={busy}
            onSelect={(gif) => {
              void handleGifSelect(gif);
            }}
          />
        </div>
      ) : null}

      <MessageAttachmentStrip
        attachments={attachments}
        onEdit={handleEditAttachment}
        onRemove={removeAttachment}
        onRetry={retryAttachment}
      />

      <div className="reels-input relative flex items-center gap-2 rounded-2xl! px-3 py-2">
        {dragActive ? (
          <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#ff9500]/70 bg-black/5 text-xs font-medium text-[#ff9500]">
            Drop images to attach
          </span>
        ) : null}
        <input
          accept="image/*"
          className="hidden"
          multiple
          onChange={handleFileInputChange}
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
          onPaste={handlePaste}
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
          disabled={sendDisabled}
          onClick={() => {
            void handleSend();
          }}
          // Keep the textarea focused through the click: mousedown would
          // otherwise blur it first, leaving the input inactive after send
          // (and dropping the mobile keyboard).
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {editingAttachment ? (
        <MessageImageEditDialog
          file={editingAttachment.file}
          kind={editingAttachment.kind}
          objectUrl={editingAttachment.objectUrl}
          onClose={() => setEditingId(null)}
          onSave={(file) => {
            replaceAttachmentFile(editingAttachment.id, file);
          }}
        />
      ) : null}
    </div>
  );
}
