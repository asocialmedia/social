"use client";

import { Check, Copy, MessageSquareQuote, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import { deleteMessage } from "@/lib/messages/client";
import type { MessagePayload } from "@/lib/messages/crypto";
import { cn, formatRelativeDate } from "@/lib/utils";

import { PostEmbed } from "./post-embed";

interface MessageBubbleProps {
  content: MessagePayload | null;
  isDecrypting: boolean;
  message: {
    ciphertext: string;
    createdAt: Date;
    deletedAt: Date | null;
    id: string;
    iv: string;
    ratchetIndex: number;
    sender?: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    } | null;
    senderId: string;
  };
  myUserId: string;
  onReply: () => void;
  peerName: string;
  quote: { senderName: string; content: string } | null;
}

export function MessageBubble({
  content,
  isDecrypting,
  message,
  myUserId,
  onReply,
  peerName,
  quote,
}: MessageBubbleProps) {
  const mine = message.senderId === myUserId;
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyText = useCallback(async () => {
    if (!content || content.type !== "text") {
      return;
    }
    try {
      await navigator.clipboard.writeText(content.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort
    }
  }, [content]);

  useEffect(() => {
    // Deferred so the effect body never calls setState synchronously.
    const timer = setTimeout(() => setShowActions(false), 0);
    return () => clearTimeout(timer);
  }, [message.id]);

  function renderContent() {
    if (isDecrypting) {
      return (
        <span className="flex items-center gap-1.5 opacity-70">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          decrypting…
        </span>
      );
    }
    if (content === null) {
      return <span className="italic opacity-70">Unreadable message</span>;
    }
    if (content.type === "text") {
      return (
        <p className="min-w-0 break-words whitespace-pre-wrap">
          {content.content}
          <span
            className={cn(
              "mt-1 ml-2 inline-block align-bottom text-[10px] tabular-nums",
              mine ? "text-white/70" : "text-muted-foreground"
            )}
          >
            {formatRelativeDate(message.createdAt)}
          </span>
        </p>
      );
    }
    return <PostEmbed postId={content.postId} mine={mine} />;
  }

  if (message.deletedAt) {
    return (
      <div
        className={cn(
          "flex items-end gap-2",
          mine ? "justify-end" : "justify-start"
        )}
      >
        {mine ? null : (
          <UserAvatar avatarUrl={message.sender?.avatarUrl ?? null} size={28} />
        )}
        <div className="text-muted-foreground/60 border-border/40 my-0.5 rounded-2xl border border-dashed px-3.5 py-2 text-xs italic">
          This message was deleted
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-end gap-2",
        mine ? "justify-end" : "justify-start"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {mine ? null : (
        <UserAvatar avatarUrl={message.sender?.avatarUrl ?? null} size={28} />
      )}

      <div
        className={cn(
          "max-w-[75%] flex-col",
          mine ? "items-end" : "items-start",
          "flex"
        )}
      >
        {mine ? null : (
          <span className="text-muted-foreground mb-0.5 ml-1 text-[11px]">
            {message.sender?.displayName ?? peerName}
          </span>
        )}

        <div className="flex items-end gap-1.5">
          {showActions ? (
            <div
              className={cn(
                "flex items-center gap-0.5",
                mine ? "order-first" : "order-last"
              )}
            >
              <BubbleAction
                ariaLabel="Copy message"
                icon={
                  copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )
                }
                onClick={() => {
                  void copyText();
                }}
              />
              <BubbleAction
                ariaLabel="Reply"
                icon={<MessageSquareQuote className="h-3.5 w-3.5" />}
                onClick={onReply}
              />
              <BubbleAction
                ariaLabel="Delete"
                className="hover:text-red-500"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  void deleteMessage(message.id);
                }}
              />
            </div>
          ) : null}

          <div
            className={cn(
              "relative rounded-2xl px-3.5 py-2 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]",
              mine
                ? "rounded-br-sm bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                : "border-border/60 rounded-bl-sm border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
            )}
          >
            {quote ? (
              <div
                className={cn(
                  "mb-1.5 flex items-center gap-2 overflow-hidden rounded-lg py-1.5 pr-2.5 pl-2 text-xs",
                  mine ? "bg-black/20" : "bg-muted/40"
                )}
              >
                <MessageSquareQuote
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    mine ? "text-white/70" : "text-muted-foreground"
                  )}
                />
                <div className="min-w-0">
                  <span
                    className={cn(
                      "block truncate font-semibold",
                      mine ? "text-white/90" : "text-foreground"
                    )}
                  >
                    {quote.senderName}
                  </span>
                  <span
                    className={cn(
                      "block truncate",
                      mine ? "text-white/70" : "text-muted-foreground"
                    )}
                  >
                    {quote.content}
                  </span>
                </div>
              </div>
            ) : null}

            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

function BubbleAction({
  ariaLabel,
  className,
  icon,
  onClick,
}: {
  ariaLabel: string;
  className?: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "text-muted-foreground hover:bg-muted/60 flex h-6 w-6 items-center justify-center rounded-md transition-colors",
        className
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}
