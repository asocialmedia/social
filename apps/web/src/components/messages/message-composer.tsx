"use client";

import type { BubbleEntranceRegistry } from "@asm/messages";
import { ChatDraftStore, throwChatError } from "@asm/messages";
// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  FileText,
  ImagePlus,
  MessageSquareQuote,
  Pencil,
  Plus,
  Smile,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import KlipyGifPicker from "@/components/comments/composer/klipy-gif-picker";
import type { KlipyGif } from "@/components/comments/composer/klipy-gif-picker";
import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import { MessageAttachmentStrip } from "@/components/messages/message-attachment-strip";
import { MessageComposerInput } from "@/components/messages/message-composer-input";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { MessageReactionPicker } from "@/components/messages/message-reaction-picker";
import { StickerPicker } from "@/components/messages/sticker-picker";
import { useMessageAttachments } from "@/components/messages/use-message-attachments";
import { toast } from "@/lib/gooey-toast";
import { messageWindowIncludesLatest } from "@/lib/messages/anchored-window";
import {
  MessagesApiError,
  foldMessageIntoBoundedData,
  ensureConversationKeys,
  fetchConversationDetail,
  sendEncryptedMessage,
  sendTypingIndicator,
} from "@/lib/messages/client";
import type {
  ConversationDetailResponse,
  MessagePageAxis,
} from "@/lib/messages/client";
import {
  composerPlaceholder,
  replySenderFallbackName,
} from "@/lib/messages/composer-copy";
import type { MessagePayload } from "@/lib/messages/crypto";
import { messageDecryptor } from "@/lib/messages/decryptor";
import type { MessageOutbox } from "@/lib/messages/outbox";
import type { MessagePage } from "@/lib/messages/types";
import { cn } from "@/lib/utils";

// Cropper is heavy; only pull it in when a sender edits an image.
const MessageImageEditDialog = dynamic(
  () => import("@/components/messages/message-image-edit-dialog"),
  { ssr: false }
);

const normalDrafts = new ChatDraftStore();

interface MessageComposerProps {
  outbox?: MessageOutbox;
  entrances?: BubbleEntranceRegistry;
  incognito?: {
    sessionId: string;
    send: (payload: MessagePayload) => Promise<boolean>;
  };
  // Set when the server told us this member is no longer inside the conversation.
  // The composer stays mounted and keeps its draft; only the controls go quiet, so
  // being removed from a den mid-sentence does not throw away what was being
  // written, and the placeholder below explains why the input is dead.
  accessEnded?: boolean;
  conversation: ConversationDetailResponse;
  editTarget: {
    content: string;
    id: string;
    payloadType: MessagePayload["type"];
  } | null;
  onDraftInput: () => void;
  onEditCancel: () => void;
  onEditSave: (content: string) => Promise<boolean>;
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
  payload: MessagePayload,
  clientMessageId?: string
): Promise<Awaited<ReturnType<typeof sendEncryptedMessage>>> {
  try {
    return await sendEncryptedMessage(
      conversationId,
      rootKey,
      senderId,
      nextIndex,
      payload,
      clientMessageId
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
        payload,
        clientMessageId
      );
    }
    throw error;
  }
}

export function MessageComposer({
  outbox,
  entrances,
  incognito,
  accessEnded = false,
  conversation,
  editTarget,
  onDraftInput,
  onEditCancel,
  onEditSave,
  onReplyCancel,
  onSent,
  replyTarget,
}: MessageComposerProps) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const queryClient = useQueryClient();
  const [text, setText] = useState(() =>
    incognito
      ? ""
      : normalDrafts.get(user?.id ?? "", conversation.conversation.id)
  );
  const [savingEdit, setSavingEdit] = useState(false);
  const [sending, setSending] = useState(false);
  const [expressionKeyboardOpen, setExpressionKeyboardOpen] = useState(false);
  const [expressionTab, setExpressionTab] = useState<
    "emoji" | "gifs" | "stickers"
  >("emoji");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);
  // The message id whose text the textarea currently holds. When it changes,
  // the composer replaces its draft with that message's body; comparing the id
  // (not the string) means typing in an active edit is never clobbered by a
  // re-render.
  const seededEditIdRef = useRef<string | null>(null);

  const conversationId = conversation.conversation.id;
  const draftKey = `chat-draft:${conversationId}`;
  const editing = editTarget !== null;

  // Seed the textarea when entering edit mode (or switching between messages).
  // Deferred through a microtask so the effect body never sets state
  // synchronously, matching the repo's pattern for derived-state sync.
  useEffect(() => {
    const target = editTarget;
    if (!target) {
      seededEditIdRef.current = null;
      return;
    }
    if (seededEditIdRef.current === target.id) {
      return;
    }
    seededEditIdRef.current = target.id;
    queueMicrotask(() => {
      setText(target.content);
    });
  }, [editTarget]);
  // Drafts survive mode switches in account-scoped memory and never enter browser storage.
  useEffect(() => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // Reconcile safely on the next request; do not expose source errors.
    }
  }, [draftKey]);
  useEffect(() => {
    if (!incognito && !editing && user) {
      normalDrafts.set(user.id, conversationId, text);
    }
  }, [text, conversationId, user?.id, editing, user, incognito]);

  const {
    addFiles,
    attachments,
    canSend,
    claimAttachments,
    isUploading,
    readyGroups,
    removeAttachment,
    removeAttachments,
    replaceAttachmentFile,
    restoreAttachments,
    resumeAttachmentUpload,
    retryAttachment,
  } = useMessageAttachments(conversationId, incognito?.sessionId);
  const viewOnceMode = attachments.some((attachment) => attachment.viewOnce);

  const editingAttachment = attachments.find(
    (attachment) => attachment.id === editingId
  );

  // The peer, and only once this device knows who it is.
  //
  // Gated on the session rather than only on the comparison, because with no session
  // every `member.userId !== undefined` is true and the FIRST member came back - so
  // during the window before the session resolved a DM named the wrong person, and a
  // den named whichever of its members happened to be listed first. Nothing downstream
  // can act on it (`sendPayload` already refuses without a user), but it is the one
  // thing the reader can see, so it says "them" instead.
  //
  // `user` rather than `user?.id` as the dependency, which the React Compiler
  // enforces: it infers `user`, and a narrower listed dependency is a manual memo it
  // cannot preserve.
  const peer = useMemo(
    () =>
      user
        ? conversation.conversation.members.find(
            (member) => member.userId !== user.id
          )
        : undefined,
    [conversation.conversation.members, user]
  );

  // A den has no single peer, so it is never addressed by one. `peer` above stays
  // as it is because the send path guards on it, but the two things that NAME
  // somebody - the placeholder and the reply byline - read this instead.
  const isDen = conversation.conversation.type === "DEN";
  const visibleExpressionTab = expressionTab;
  const placeholder = composerPlaceholder({
    denName: conversation.conversation.name ?? null,
    editing,
    isDen,
    peerDisplayName: peer?.user.displayName ?? null,
    writeBlockedByMembership: accessEnded,
  });

  // Unwrap the root key, encrypt, post, and fold the sent message into the
  // cache. Shared by text, image, and GIF sends so every message type uses the
  // same ratchet-index and dedupe rules.
  const sendPayload = useCallback(
    async (
      payload: MessagePayload,
      options?: { preserveInput?: boolean; outgoingId?: string }
    ): Promise<boolean> => {
      if (!user || !privateKey || !peer) {
        return false;
      }
      let outgoingId: string | undefined;
      try {
        if (!incognito && outbox) {
          outgoingId = options?.outgoingId ?? crypto.randomUUID();
          const previous = outbox.get(outgoingId);
          if (!previous) {
            const editor = textareaRef.current;
            const sendButton = editor
              ?.closest("[data-message-composer]")
              ?.querySelector("[data-message-send]");
            const source = sendButton?.getBoundingClientRect();
            entrances?.register(
              outgoingId,
              Date.now(),
              source
                ? { x: source.right, y: source.top + source.height / 2 }
                : undefined
            );
          }
          outbox.start(
            previous?.message ?? {
              ciphertext: "",
              conversationId: conversation.conversation.id,
              createdAt: new Date(),
              deletedAt: null,
              editedAt: null,
              id: outgoingId,
              iv: "",
              ratchetIndex: 0,
              senderId: user.id,
            },
            payload
          );
          if (!options?.preserveInput) {
            setText("");
            onReplyCancel();
            requestAnimationFrame(() =>
              textareaRef.current?.focus({ preventScroll: true })
            );
          }
          onSent();
        }
        if (incognito) {
          const sent = await incognito.send(payload);
          if (sent && !options?.preserveInput) {
            setText("");
            onReplyCancel();
          }
          if (sent) {
            onSent();
          }
          return sent;
        }
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
          throwChatError(new Error("Message keys aren't ready yet"));
        }

        // Next ratchet index = max(server count at fetch, own messages loaded).
        const ownCacheCount = (
          queryClient.getQueryData<{
            pages: { messages: { senderId: string }[] }[];
          }>(["messages", conversation.conversation.id])?.pages ?? []
        )
          .flatMap((page) => page.messages)
          .filter((message) => message.senderId === user.id).length;

        const computedIndex = Math.max(
          conversation.mySentCount,
          ownCacheCount,
          outbox?.nextRatchetIndex ?? 0
        );

        // A concurrent send can still race us; sendWithRatchetRetry retries
        // once at the server's authoritative index when that happens.
        const sent = await sendWithRatchetRetry(
          conversation.conversation.id,
          rootKey,
          user.id,
          computedIndex,
          payload,
          outgoingId
        );

        entrances?.register(sent.id);
        if (outbox && outgoingId) {
          messageDecryptor.rememberSent(outbox.scope, sent.id, payload);
          outbox.acknowledge(sent);
        }
        const reconcile = () => {
          queryClient.setQueryData<InfiniteData<MessagePage, MessagePageAxis>>(
            ["messages", conversation.conversation.id],
            (old) =>
              !old || !messageWindowIncludesLatest(old.pages, old.pageParams)
                ? old
                : (foldMessageIntoBoundedData(old, sent) ?? old)
          );
        };
        if (outbox) {
          outbox.deferRefresh(`sent:${sent.id}`, reconcile);
          outbox.deferRefresh("conversation-list", () => {
            void queryClient.invalidateQueries({
              queryKey: ["message-conversations", user.id],
            });
          });
          outbox.deferRefresh("conversation-detail", () => {
            void queryClient.invalidateQueries({
              queryKey: ["message-conversation", conversation.conversation.id],
            });
          });
        } else {
          reconcile();
          if (!options?.preserveInput) {
            setText("");
            onReplyCancel();
          }
          onSent();
          void queryClient.invalidateQueries({
            queryKey: ["message-conversations", user.id],
          });
          void queryClient.invalidateQueries({
            queryKey: ["message-conversation", conversation.conversation.id],
          });
        }
        return true;
      } catch (error) {
        if (outgoingId && outbox?.wasAcknowledged(outgoingId)) {
          return true;
        }
        if (outgoingId) {
          outbox?.fail(outgoingId);
        }
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't send message",
          title: "Message not sent",
          variant: "destructive",
        });
        // The outbox owns failed payloads and their claimed media until retry.
        // Callers may remove attachment tiles without discarding those media.
        return Boolean(outgoingId && outbox?.get(outgoingId));
      }
    },
    [
      conversation.conversation,
      conversation.mySentCount,
      onReplyCancel,
      onSent,
      entrances,
      outbox,
      peer,
      privateKey,
      queryClient,
      user,
      incognito,
    ]
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? text.length;
      const end = textarea?.selectionEnd ?? start;
      const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
      setText(next);
      if (next.length > 0) {
        onDraftInput();
      }
      if (!incognito && !editing && emoji.trim().length > 0) {
        const now = Date.now();
        if (now - lastTypingRef.current >= 3000) {
          lastTypingRef.current = now;
          void sendTypingIndicator(conversation.conversation.id);
        }
      }
      requestAnimationFrame(() => {
        if (!textarea) {
          return;
        }
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      });
    },
    [conversation.conversation.id, editing, incognito, onDraftInput, text]
  );

  useEffect(
    () =>
      outbox?.setRetryHandler(async (entry) => {
        if (sending || accessEnded) {
          return;
        }
        setSending(true);
        try {
          await sendPayload(entry.payload, {
            outgoingId: entry.message.id,
            preserveInput: true,
          });
        } catch {
          // Keep unexpected failures retryable and release the composer.
        }
        setSending(false);
      }),
    [accessEnded, outbox, sendPayload, sending]
  );

  const handleEditSave = useCallback(async () => {
    const content = text.trim();
    if (savingEdit || !editing) {
      return;
    }
    // A text message must keep a body; a media/post caption may be cleared.
    if (editTarget?.payloadType === "text" && content.length === 0) {
      return;
    }
    setSavingEdit(true);
    const ok = await onEditSave(content);
    setSavingEdit(false);
    if (ok) {
      setText("");
      requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true });
      });
    }
  }, [editing, editTarget?.payloadType, onEditSave, savingEdit, text]);

  const handleSend = useCallback(async () => {
    if (sending) {
      return;
    }
    // Edit mode repurposes the send button into "save changes".
    if (editing) {
      await handleEditSave();
      return;
    }
    const content = text.trim();
    if (attachments.length === 0 && (!content || viewOnceMode)) {
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
          const viewOnceOnly = group.attachments.some(
            (attachment) => attachment.kind === "view-once"
          );
          const payload: MessagePayload = {
            attachments: group.attachments,
            content: first && !viewOnceOnly && content ? content : undefined,
            type: "media",
            ...(first && replyTarget
              ? {
                  replyToId: replyTarget.id,
                  replyToSenderId: replyTarget.senderId,
                }
              : {}),
          };
          // Stop treating these rows as discardable BEFORE awaiting the send.
          // Once the server has the media ids it cannot tell a row backing a
          // sent message from an abandoned draft, so a discard racing this send
          // (unmount on conversation switch, onSent's re-renders) would clear
          // the conversation link and 404 the image for the peer for good.
          const claimed = claimAttachments(group.attachmentIds);
          // oxlint-disable-next-line no-await-in-loop -- album groups share one ratchet sequence, so they must be encrypted and sent in order.
          const ok = await sendPayload(payload).catch((error: unknown) => {
            // A throw means the request never landed, so these rows still back
            // no message. They have to be re-staged exactly like the `!ok` path
            // below: `claimAttachments` detached them from the tracked set, so
            // without this the tiles are orphaned and the conversation-linked
            // rows are left with neither a message nor the tile-driven discard
            // that would eventually reclaim them.
            restoreAttachments(claimed);
            throw error;
          });
          if (!ok) {
            // Nothing referenced these rows, so re-stage them: the sender can
            // retry, and they stay reclaimable if they leave the thread.
            restoreAttachments(claimed);
            // Leave the failed group and any unsent ones staged and tracked so
            // the sender can retry and their media rows are still reclaimed if
            // they leave the thread. Groups already sent above stay removed.
            setSending(false);
            return;
          }
          // The outbox or acknowledged message owns these media now. Drop the
          // draft tiles without discarding references a retry still needs.
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
    // Keep focus on the next draft without moving the transcript.
    setSending(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }, [
    attachments.length,
    canSend,
    claimAttachments,
    editing,
    handleEditSave,
    peer,
    privateKey,
    readyGroups,
    removeAttachments,
    replyTarget,
    restoreAttachments,
    sendPayload,
    sending,
    text,
    user,
    viewOnceMode,
  ]);

  const handleFilesSelected = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? [...files] : [];
      if (list.length > 0) {
        const added = addFiles(list, { editSinglePhoto: true });
        if (added?.editId) {
          setEditingId(added.editId);
        }
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
      setExpressionKeyboardOpen(false);
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

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (accessEnded) {
        return;
      }
      if (event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
        setDragActive(true);
      }
    },
    [accessEnded]
  );

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
      if (accessEnded) {
        return;
      }
      handleFilesSelected(event.dataTransfer.files);
    },
    [accessEnded, handleFilesSelected]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const { files } = event.clipboardData ?? {};
      if (files && files.length > 0) {
        event.preventDefault();
        if (accessEnded) {
          return;
        }
        handleFilesSelected(files);
      }
    },
    [accessEnded, handleFilesSelected]
  );

  const handleEditAttachment = useCallback((id: string) => {
    setEditingId(id);
  }, []);

  // Leaving edit mode must not leave the edited body sitting in the composer as
  // the next draft; clear it back to empty.
  const handleCancelEdit = useCallback(() => {
    setText("");
    onEditCancel();
  }, [onEditCancel]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape" && editing) {
        event.preventDefault();
        handleCancelEdit();
        return;
      }
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
    [editing, handleCancelEdit, handleSend]
  );

  const busy = sending || savingEdit;
  // In edit mode only the text matters: attachments are hidden, so the button
  // is enabled purely by a non-empty body. A media/post caption may be cleared
  // to remove it, so an empty body is allowed for those types.
  const emptyBodyBlocksSave =
    editTarget?.payloadType === "text" && text.trim().length === 0;
  const sendDisabled =
    accessEnded ||
    (editing
      ? busy || emptyBodyBlocksSave
      : busy ||
        isUploading ||
        (attachments.length > 0
          ? !canSend
          : viewOnceMode || text.trim().length === 0));
  // One flag for every control that would start a write, so a removed member
  // cannot slip a send through the Enter key or a pasted attachment while the
  // button is merely greyed out.
  const writeBlocked = accessEnded || busy;

  // The send button doubles as a save button in edit mode; a spinner wins while
  // either request is in flight.
  function renderSendIcon() {
    if (busy) {
      return <ZephLoader variant="messages" className="h-4 w-4" />;
    }
    if (editing) {
      return <Check className="h-4 w-4" />;
    }
    return <ArrowUp className="h-4 w-4" />;
  }

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
      {editing ? (
        <div className="border-border/60 bg-muted/40 mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs">
          <Pencil className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Editing message</span>
            {editTarget.content ? (
              <span className="text-muted-foreground block truncate">
                {editTarget.content}
              </span>
            ) : null}
          </div>
          <button
            aria-label="Cancel edit"
            className="icon-btn-3d ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            onClick={handleCancelEdit}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {replyTarget && !editing ? (
        <div className="border-border/60 bg-muted/40 mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs">
          <MessageSquareQuote className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground">Replying to </span>
            <span className="font-medium">
              {replyTarget.senderName ??
                replySenderFallbackName({
                  isDen,
                  peerDisplayName: peer?.user.displayName ?? null,
                  senderIsMe: replyTarget.senderId === user?.id,
                })}
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

      <div
        aria-label="Expression keyboard"
        className={cn(
          "panel-3d mb-2 h-[min(52dvh,420px)] w-full flex-col overflow-hidden rounded-2xl p-2",
          expressionKeyboardOpen ? "flex" : "hidden"
        )}
      >
        <div
          aria-label="Message expressions"
          className="bg-muted/40 mb-2 grid grid-cols-3 gap-1 rounded-xl p-1"
          role="tablist"
        >
          {(["emoji", "gifs", "stickers"] as const).map((tab) => (
            <button
              aria-selected={visibleExpressionTab === tab}
              className={cn(
                "focus-visible:ring-primary min-h-10 rounded-lg px-3 text-sm font-medium capitalize transition-colors focus-visible:ring-2",
                visibleExpressionTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              key={tab}
              disabled={editing && tab !== "emoji"}
              onClick={() => setExpressionTab(tab)}
              role="tab"
              type="button"
            >
              {tab === "gifs" ? "GIFs" : tab}
            </button>
          ))}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          hidden={visibleExpressionTab !== "emoji"}
        >
          <MessageReactionPicker
            disabled={false}
            onReact={insertEmoji}
            title="Emoji"
          />
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          hidden={visibleExpressionTab !== "gifs" || Boolean(editing)}
        >
          <KlipyGifPicker
            disabled={busy}
            onSelect={(gif) => {
              void handleGifSelect(gif);
            }}
          />
        </div>
        <div
          className="min-h-0 flex-1"
          hidden={visibleExpressionTab !== "stickers" || Boolean(editing)}
        >
          <StickerPicker
            active={
              expressionKeyboardOpen && visibleExpressionTab === "stickers"
            }
            key={user?.id}
            canCreate={!incognito && !editing && !accessEnded}
            conversationId={conversation.conversation.id}
            disabled={busy || accessEnded || editing || viewOnceMode}
            incognitoSessionId={incognito?.sessionId}
            onSend={async (payload) => {
              const sent = await sendPayload(payload, {
                preserveInput: true,
              });
              if (sent) {
                onReplyCancel();
              }
              return sent;
            }}
            replyTarget={replyTarget}
          />
        </div>
      </div>

      {editing ? null : (
        <MessageAttachmentStrip
          attachments={attachments}
          onEdit={handleEditAttachment}
          onRemove={removeAttachment}
          onRetry={retryAttachment}
        />
      )}

      <div
        className="premium-input relative flex items-end gap-0 rounded-[1.625rem]! p-1.5"
        data-message-composer=""
      >
        {dragActive ? (
          <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#ff9500]/70 bg-black/5 text-xs font-medium text-[#ff9500]">
            Drop files to attach
          </span>
        ) : null}
        <input
          accept="image/*,video/*,audio/*,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="hidden"
          multiple
          onChange={handleFileInputChange}
          ref={fileInputRef}
          type="file"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Add attachment"
              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-primary flex h-10 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 disabled:opacity-40 pointer-coarse:w-10"
              disabled={writeBlocked || editing || viewOnceMode}
              type="button"
            >
              <Plus className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-52"
            side="top"
            sideOffset={12}
          >
            <DropdownMenuItem
              className="gap-3"
              onSelect={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = "image/*,video/*";
                  fileInputRef.current.click();
                }
              }}
            >
              <ImagePlus className="size-4" />
              Photos & videos
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-3"
              onSelect={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept =
                    "audio/*,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation";
                  fileInputRef.current.click();
                }
              }}
            >
              <FileText className="size-4" />
              Files
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          aria-expanded={expressionKeyboardOpen}
          aria-label="Open emoji, GIF, and sticker keyboard"
          className={cn(
            "text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-primary flex h-10 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 pointer-coarse:w-10",
            expressionKeyboardOpen && "bg-muted/70 text-foreground"
          )}
          onClick={() => {
            setExpressionKeyboardOpen((open) => !open);
            if (!expressionKeyboardOpen) {
              setExpressionTab("emoji");
            }
          }}
          type="button"
        >
          <Smile className="size-5" />
        </button>
        <MessageComposerInput
          disabled={accessEnded || savingEdit || viewOnceMode}
          onChange={(event) => {
            const { value } = event.target;
            setText(value);
            // The reader is writing into this conversation, which is when a "new
            // messages" marker has done its job.
            if (value.length > 0) {
              onDraftInput();
            }
            // Typing heartbeats are meaningless while editing an existing
            // message; skip them so an edit never pings the peer.
            if (!incognito && !editing && value.trim().length > 0) {
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
          placeholder={viewOnceMode ? "View once photo" : placeholder}
          inputRef={textareaRef}
          value={text}
        />
        <button
          aria-label={editing ? "Save edit" : "Send message"}
          data-message-send=""
          className="follow-btn-3d flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
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
          {renderSendIcon()}
        </button>
      </div>

      {editingAttachment &&
      (editingAttachment.kind === "gif" ||
        editingAttachment.kind === "image") ? (
        <MessageImageEditDialog
          file={editingAttachment.file}
          kind={editingAttachment.kind}
          objectUrl={editingAttachment.objectUrl}
          viewOnce={editingAttachment.viewOnce}
          canViewOnce={attachments.length === 1 && !text.trim()}
          onClose={() => {
            resumeAttachmentUpload(editingAttachment.id);
            setEditingId(null);
          }}
          onSave={(file, viewOnce) => {
            replaceAttachmentFile(editingAttachment.id, file, { viewOnce });
            if (viewOnce) {
              setExpressionKeyboardOpen(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
