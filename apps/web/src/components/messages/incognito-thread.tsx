"use client";

// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.

import {
  canSendIncognitoDraft,
  observeChatTask,
  runChatTask,
  throwChatError,
  deriveIncognitoRootKey,
  incognitoTimeRemaining,
  extractMessageReferences,
} from "@asm/messages";
import type { IncognitoMessage, IncognitoSession } from "@asm/messages";
// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Textarea } from "@asm/ui/shadui/textarea";
import {
  ArrowLeft,
  ArrowUp,
  Clock3,
  ImagePlus,
  Loader2,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import {
  createRootKeyStore,
  ensureConversationKeys,
  fetchConversationDetail,
  resolveMyConversationWraps,
} from "@/lib/messages/client";
import { decryptMessage, encryptMessage } from "@/lib/messages/crypto";
import type { MessagePayload } from "@/lib/messages/crypto";
import {
  ChatControlError,
  chatControlRequest,
  fetchIncognitoPage,
} from "@/lib/messages/lifecycle-client";

import { useMessageAttachments } from "./use-message-attachments";

interface Row {
  message: IncognitoMessage;
  payload: MessagePayload | null;
}
interface Pending {
  id: string;
  signature: string;
}
export function IncognitoThread({
  conversationId,
  session,
  serverNow,
  fresh,
  revision,
  onBack,
  onRefresh,
  onEnd,
  busy,
  error: lifecycleError,
}: {
  conversationId: string;
  session: IncognitoSession;
  serverNow: string;
  fresh: boolean;
  revision: number;
  onBack: () => void;
  onRefresh: () => void;
  onEnd: () => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [latest, setLatest] = useState(true);
  const [clock, setClock] = useState(Date.now);
  const [foreground, setForeground] = useState(
    () => document.visibilityState === "visible" && navigator.onLine
  );
  // oxlint-disable-next-line react/hook-use-state -- The session clock offset stays fixed for this mount.
  const [clockOffset] = useState(() => Date.parse(serverNow) - Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Pending | null>(null);
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const attachments = useMessageAttachments(conversationId, session.id);
  const remaining = Date.parse(session.expiresAt) - (clock + clockOffset);
  const canView = fresh && foreground && remaining > 0;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const visibility = () => {
      setForeground(document.visibilityState === "visible" && navigator.onLine);
      onRefresh();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", visibility);
    window.addEventListener("online", visibility);
    return () => {
      mounted.current = false;
      readGeneration.current += 1;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", visibility);
      window.removeEventListener("online", visibility);
    };
  }, [onRefresh]);
  const readPage = useCallback(
    async (signal: AbortSignal, before?: number) => {
      if (!privateKey || !user) {
        throwChatError(new Error("Unlock your messages to open this session."));
      }
      readGeneration.current += 1;
      const generation = readGeneration.current;
      const [page, detail] = await Promise.all([
        fetchIncognitoPage(conversationId, session.id, signal, before),
        fetchConversationDetail(conversationId),
      ]);
      const peer = detail.conversation.members.find(
        (member) => member.userId !== user.id
      );
      const store = createRootKeyStore(privateKey);
      const roots = await store.getRootKeys(
        conversationId,
        resolveMyConversationWraps(detail.keys, detail.conversation, user.id),
        peer?.user.messageIdentity?.publicKey ?? ""
      );
      const sessionRoots = await Promise.all(
        roots.map((key) => deriveIncognitoRootKey(key, session.id))
      );
      const decoded: Row[] = [];
      for (const message of page.messages) {
        let payload: MessagePayload | null = null;
        for (const root of sessionRoots) {
          try {
            payload = await decryptMessage(
              root,
              message.senderId,
              session.id,
              message
            );
            break;
          } catch {
            // Reconcile safely on the next request; do not expose source errors.
          }
        }
        decoded.push({ message, payload });
      }
      if (
        !mounted.current ||
        signal.aborted ||
        generation !== readGeneration.current
      ) {
        return;
      }
      const element = scrollRef.current;
      const previousHeight = element?.scrollHeight ?? 0;
      const previousTop = element?.scrollTop ?? 0;
      const nearBottom = element
        ? element.scrollHeight - element.scrollTop - element.clientHeight < 100
        : true;
      setRows((previous) =>
        before === undefined
          ? decoded
          : [...decoded, ...previous]
              .filter(
                (row, index, array) =>
                  array.findIndex(
                    (candidate) => candidate.message.id === row.message.id
                  ) === index
              )
              .slice(0, 200)
      );
      setHasMore(page.hasMore);
      setReadBusy(false);
      setLocalError(null);
      if (before !== undefined) {
        requestAnimationFrame(() => {
          const scroller = scrollRef.current;
          if (scroller) {
            scroller.scrollTop =
              previousTop + scroller.scrollHeight - previousHeight;
          }
        });
      } else if (nearBottom) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        });
      }
    },
    [privateKey, user, conversationId, session.id]
  );
  useEffect(() => {
    if (!canView) {
      readGeneration.current += 1;
      queueMicrotask(() => setRows([]));
      return;
    }
    if (!latest) {
      return;
    }
    const controller = new AbortController();
    void observeChatTask(
      readPage(controller.signal),
      () => {
        // This task has no success update.
      },
      (requestFailure) => {
        if (!controller.signal.aborted && mounted.current) {
          setReadBusy(false);
          setRows([]);
          setLocalError(
            requestFailure instanceof Error
              ? requestFailure.message
              : "Messages couldn't be loaded. Retry."
          );
        }
      }
    );
    return () => controller.abort();
  }, [canView, revision, session.nextSequence, latest, readPage]);
  const send = async () => {
    if (
      sendBusy ||
      busy ||
      !canView ||
      !user ||
      !privateKey ||
      !canSendIncognitoDraft(
        draft,
        attachments.attachments.length,
        attachments.canSend
      )
    ) {
      return;
    }
    setSendBusy(true);
    setLocalError(null);
    const groups = attachments.readyGroups;
    const payloads: { payload: MessagePayload; attachmentIds: string[] }[] =
      groups.length
        ? groups.map((group, index) => ({
            attachmentIds: group.attachmentIds,
            payload: {
              content: index === 0 ? draft.trim() : undefined,
              images: group.images,
              kind: group.kind,
              type: "media",
            },
          }))
        : [
            {
              attachmentIds: [],
              payload: { content: draft.trim(), type: "text" },
            },
          ];
    return await runChatTask(
      async () => {
        try {
          let detail = await fetchConversationDetail(conversationId);
          const provisioned = await ensureConversationKeys(
            detail.conversation,
            privateKey,
            user.id,
            {
              refreshConversation: async () => {
                const refreshed = await fetchConversationDetail(conversationId);
                return refreshed.conversation;
              },
            }
          );
          if (!provisioned) {
            throwChatError(
              new Error("Message keys are unavailable. Please retry.")
            );
          }
          detail = await fetchConversationDetail(conversationId);
          const wraps = resolveMyConversationWraps(
            detail.keys,
            detail.conversation,
            user.id
          );
          const peer = detail.conversation.members.find(
            (member) => member.userId !== user.id
          );
          const roots = await createRootKeyStore(privateKey).getRootKeys(
            conversationId,
            wraps,
            peer?.user.messageIdentity?.publicKey ?? ""
          );
          if (!roots[0] || !wraps[0]) {
            throwChatError(
              new Error("Message keys are unavailable. Please retry.")
            );
          }
          const root = await deriveIncognitoRootKey(roots[0], session.id);
          let index = session.nextSequence;
          for (const entry of payloads) {
            const signature = JSON.stringify(entry.payload);
            if (!pending.current || pending.current.signature !== signature) {
              pending.current = { id: crypto.randomUUID(), signature };
            }
            const messageId = pending.current.id;
            const claimed = attachments.claimAttachments(entry.attachmentIds);
            try {
              for (let attempt = 0; ; attempt += 1) {
                const encrypted = await encryptMessage(
                  root,
                  user.id,
                  index,
                  session.id,
                  entry.payload
                );
                try {
                  await chatControlRequest(conversationId, "incognito", {
                    body: JSON.stringify({
                      ...encrypted,
                      id: messageId,
                      keyEpoch: wraps[0].version,
                      mediaIds: extractMessageReferences(entry.payload).flatMap(
                        (ref) =>
                          ref.kind === "media" && ref.requiredId
                            ? [ref.requiredId]
                            : []
                      ),
                      sessionId: session.id,
                    }),
                    method: "POST",
                  });
                  index += 1;
                  break;
                } catch (error) {
                  if (
                    error instanceof ChatControlError &&
                    error.expectedIndex !== undefined &&
                    attempt < 2
                  ) {
                    index = error.expectedIndex;
                    continue;
                  }
                  throwChatError(error);
                }
              }
            } catch (error) {
              attachments.restoreAttachments(claimed);
              throwChatError(error);
            }
            attachments.removeAttachments(entry.attachmentIds);
            pending.current = null;
          }
          if (mounted.current) {
            setDraft("");
            setLatest(true);
            onRefresh();
          }
        } catch (error) {
          if (mounted.current) {
            setLocalError(
              error instanceof Error
                ? error.message
                : "Message couldn't be sent. Your draft is still here."
            );
            onRefresh();
          }
        }
      },
      () => {
        if (mounted.current) {
          setSendBusy(false);
        }
      }
    );
  };
  const loadEarlier = async () => {
    const before = rows[0]?.message.sequence;
    if (before === undefined) {
      return;
    }
    setLatest(false);
    setReadBusy(true);
    try {
      await readPage(new AbortController().signal, before);
    } catch {
      setLocalError("Earlier messages couldn't be loaded. Retry.");
      setReadBusy(false);
    }
  };
  return (
    <section
      aria-label="Incognito conversation"
      className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-100 [--background:240_10%_4%] [--border:240_4%_20%] [--card:240_5%_10%] [--foreground:0_0%_95%] [--muted-foreground:240_5%_65%] [--muted:240_4%_15%]"
      style={{ colorScheme: "dark" }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-3 sm:px-5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to inbox; keep incognito active"
          onClick={onBack}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <Shield className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-wide">Incognito</h2>
          <p className="flex items-center gap-1 text-xs text-zinc-400">
            <Clock3 className="size-3" />
            {incognitoTimeRemaining(session.expiresAt, clock + clockOffset)}
          </p>
        </div>
        <Button
          variant="outline"
          className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-white"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmEnd(true)}
        >
          End incognito
        </Button>
      </header>
      <div className="shrink-0 border-b border-white/5 px-5 py-2 text-center text-xs leading-relaxed text-zinc-400">
        Everything here is deleted when either person ends the session or the
        timer runs out. A permanent usage notice stays in your normal chat.
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        ref={scrollRef}
        aria-label="Incognito messages"
      >
        {(() => {
          if (canView) {
            if (readBusy && !rows.length) {
              return (
                <div aria-live="polite" className="flex justify-center p-8">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="sr-only">Opening incognito messages</span>
                </div>
              );
            }
            return (
              <>
                {hasMore ? (
                  <div className="mb-4 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readBusy}
                      onClick={() => {
                        void loadEarlier();
                      }}
                    >
                      Load earlier messages
                    </Button>
                  </div>
                ) : null}
                {!rows.length && !localError ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <Shield className="mb-4 size-10 text-zinc-500" />
                    <h3 className="text-lg font-medium">
                      A conversation for the moment
                    </h3>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-zinc-400">
                      Start chatting here. Your normal history is waiting
                      outside this session.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {rows.map(({ message, payload }) => (
                    <div
                      key={message.id}
                      className={`flex ${message.senderId === user?.id ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${message.senderId === user?.id ? "bg-zinc-200 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
                      >
                        {payload?.type === "media" ? (
                          <div className="mb-2 grid grid-cols-2 gap-1">
                            {("images" in payload
                              ? payload.images
                              : [{ url: payload.url }]
                            ).map((image, index) => (
                              <Image
                                key={`${message.id}:${index}`}
                                src={image.url}
                                alt="Incognito attachment"
                                width={image.width ?? 240}
                                height={image.height ?? 240}
                                unoptimized
                                className="h-auto max-h-60 rounded-lg object-contain"
                              />
                            ))}
                          </div>
                        ) : null}
                        <p className="text-sm break-words whitespace-pre-wrap">
                          {payload?.content ??
                            (payload
                              ? ""
                              : "This message couldn't be decrypted on this account.")}
                        </p>
                        <time
                          className="mt-1 block text-right text-[10px] opacity-60"
                          dateTime={message.createdAt}
                        >
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          }
          return (
            <div
              aria-live="polite"
              className="flex h-full flex-col items-center justify-center gap-3 text-center"
            >
              <Shield className="size-8 text-zinc-500" />
              <p className="text-sm">
                Reconnect to view this incognito session.
              </p>
              <p className="text-xs text-zinc-400">
                The session timer keeps running.
              </p>
              <Button variant="outline" onClick={onRefresh}>
                Retry connection
              </Button>
            </div>
          );
        })()}
      </div>
      {latest ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLatest(true);
            onRefresh();
          }}
        >
          Return to latest messages
        </Button>
      )}
      {localError || lifecycleError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-5 py-2 text-sm text-amber-300"
        >
          <span>{localError ?? lifecycleError}</span>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-1 size-3" />
            Retry
          </Button>
        </div>
      ) : null}
      <form
        className="shrink-0 border-t border-white/10 p-3 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {attachments.attachments.length ? (
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {attachments.attachments.map((attachment) => (
              <div key={attachment.id} className="relative w-20 shrink-0">
                <Image
                  src={attachment.objectUrl}
                  alt="Staged image"
                  width={80}
                  height={80}
                  unoptimized
                  className="size-20 rounded-xl object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove staged image"
                  className="icon-btn-3d absolute top-0 right-0 p-1"
                  disabled={sendBusy}
                  onClick={() => attachments.removeAttachment(attachment.id)}
                >
                  <X className="size-3" />
                </button>
                <p className="mt-1 text-[10px] text-zinc-400">
                  {(() => {
                    if (attachment.status === "ready") {
                      return "Ready";
                    }
                    if (attachment.status === "error") {
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            attachments.retryAttachment(attachment.id)
                          }
                        >
                          Retry upload
                        </button>
                      );
                    }
                    return `Uploading ${attachment.progress}%`;
                  })()}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) {
                attachments.addFiles([...event.target.files]);
              }
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach image to incognito message"
            disabled={sendBusy || !canView}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-5" />
          </Button>
          <Textarea
            aria-label="Incognito message"
            placeholder="Message in incognito…"
            value={draft}
            maxLength={8000}
            disabled={sendBusy || !canView}
            rows={1}
            className="max-h-36 min-h-10 resize-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="submit"
            variant="premium"
            size="icon"
            aria-label="Send incognito message"
            disabled={
              sendBusy ||
              !canView ||
              !canSendIncognitoDraft(
                draft,
                attachments.attachments.length,
                attachments.canSend
              )
            }
          >
            {sendBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-center text-[10px] text-zinc-500">
          Incognito messages are excluded from chat exports.
        </p>
      </form>
      <Dialog
        open={confirmEnd}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirmEnd(open);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>End incognito for both of you?</DialogTitle>
            <DialogDescription>
              All messages and attachments in this session will be deleted,
              including unread messages. Your normal history and the permanent
              usage notice remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmEnd(false)}
            >
              Keep chatting
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void onEnd();
              }}
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              End and delete messages
            </Button>
          </DialogFooter>
          {lifecycleError ? (
            <p role="alert" className="text-sm text-red-600">
              {lifecycleError}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
