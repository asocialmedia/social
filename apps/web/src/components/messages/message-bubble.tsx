"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  Check,
  Copy,
  MessageSquareQuote,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import { toast } from "@/lib/gooey-toast";
import { deleteMessage } from "@/lib/messages/client";
import type { MessagePayload } from "@/lib/messages/crypto";
import { setPopupOpen } from "@/lib/popup-tracker";
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
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
    setPopupOpen(open);
  }, []);

  const handleDelete = useCallback(async () => {
    try {
      await deleteMessage(message.id);
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't delete message",
        title: "Delete failed",
        variant: "destructive",
      });
    }
  }, [message.id]);

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

  function renderContent() {
    if (isDecrypting) {
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-block h-3.5 w-24 animate-pulse rounded bg-current opacity-30" />
        </div>
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
    if (content.type === "media") {
      return (
        <div
          className={cn(
            "max-w-full overflow-hidden rounded-lg",
            mine ? "bg-black/15" : "bg-muted/40"
          )}
        >
          <Image
            alt={content.kind === "gif" ? "GIF" : "Shared image"}
            className="h-auto max-h-72 w-full max-w-full object-contain"
            height={content.height ?? 200}
            src={content.url}
            unoptimized={content.kind === "gif"}
            width={content.width ?? 280}
          />
        </div>
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
        <div className="text-muted-foreground/60 border-border/40 my-0.5 max-w-[85%] min-w-0 rounded-2xl border border-dashed px-3.5 py-2 text-xs italic sm:max-w-[75%]">
          This message was deleted
        </div>
      </div>
    );
  }

  // While the payload is being decrypted the bubble is hidden entirely; the
  // thread shows one aggregate "decrypting" line instead of a spinner on
  // every message, which gets noisy on long chats.
  if (isDecrypting) {
    return null;
  }

  return (
    <div
      className={cn(
        "group flex items-end gap-2",
        mine ? "justify-end" : "justify-start"
      )}
    >
      {mine ? null : (
        <UserAvatar avatarUrl={message.sender?.avatarUrl ?? null} size={28} />
      )}

      <div
        className={cn(
          "max-w-[85%] min-w-0 flex-col sm:max-w-[75%]",
          mine ? "items-end" : "items-start",
          "flex"
        )}
      >
        {mine ? null : (
          <span className="text-muted-foreground mb-0.5 ml-1 text-[11px]">
            {message.sender?.displayName ?? peerName}
          </span>
        )}

        <div className="flex max-w-full min-w-0 items-end gap-1.5">
          {/* Desktop: inline actions revealed on hover/focus. */}
          <div
            className={cn(
              "flex items-center gap-0.5 transition-opacity duration-150",
              "opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-sm:hidden",
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
            {mine ? (
              <BubbleAction
                ariaLabel="Delete"
                className="hover:text-red-500"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  void handleDelete();
                }}
              />
            ) : null}
          </div>

          {/* Mobile: message options tucked into a dropdown, styled like the
              postcard's more menu (apple-panel + pill-3d-hover items). */}
          <div
            className={cn(
              "max-sm:block sm:hidden",
              mine ? "order-first" : "order-last"
            )}
          >
            <DropdownMenu onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Message options"
                  className={cn(
                    "pill-3d-hover text-muted-foreground inline-flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 active:translate-y-px",
                    menuOpen && "opacity-100"
                  )}
                  type="button"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="apple-panel min-w-36 p-1.5 shadow-none"
              >
                <DropdownMenuItem
                  className="pill-3d-hover rounded-md px-2 py-2"
                  onClick={() => {
                    void copyText();
                  }}
                >
                  <span className="flex items-center gap-3">
                    <Copy className="size-4" />
                    Copy
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="pill-3d-hover rounded-md px-2 py-2"
                  onClick={onReply}
                >
                  <span className="flex items-center gap-3">
                    <MessageSquareQuote className="size-4" />
                    Reply
                  </span>
                </DropdownMenuItem>
                {mine ? (
                  <DropdownMenuItem
                    className="pill-3d-hover rounded-md px-2 py-2"
                    onClick={() => {
                      void handleDelete();
                    }}
                  >
                    <span className="text-destructive flex items-center gap-3">
                      <Trash2 className="size-4" />
                      Delete
                    </span>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div
            className={cn(
              "relative max-w-full min-w-0 rounded-2xl px-3.5 py-2 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]",
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
