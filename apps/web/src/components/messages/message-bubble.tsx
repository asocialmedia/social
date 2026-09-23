"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import {
  Check,
  Copy,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { useCallback, useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import type { MessagePayload } from "@/lib/messages/crypto";
import { isWithinEditWindow } from "@/lib/messages/edit-window";
import { cn, formatRelativeDate } from "@/lib/utils";

import { bubbleRoundingClasses } from "./message-bubble-shape";
import type { BubblePosition } from "./message-bubble-shape";
import { MessageLinkEmbed } from "./message-link-embed";
import { MessageMediaAlbum } from "./message-media-album";
import { PostEmbed } from "./post-embed";

interface MessageBubbleProps {
  content: MessagePayload | null;
  isDecrypting: boolean;
  message: {
    ciphertext: string;
    createdAt: Date;
    deletedAt: Date | null;
    editedAt: Date | string | null;
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
  onEdit: () => void;
  onReply: () => void;
  quote: { senderName: string; content: string } | null;
  quotePending: boolean;
  // Where this message sits in its sender-run. Drives both the corner rounding
  // (a run reads as one block) and whether the peer avatar is drawn.
  position: BubblePosition;
  /** True while the transcript is in select mode (hides hover actions). */
  selectionActive: boolean;
}

export function MessageBubble({
  content,
  isDecrypting,
  message,
  myUserId,
  onEdit,
  onReply,
  quote,
  quotePending,
  position,
  selectionActive,
}: MessageBubbleProps) {
  const mine = message.senderId === myUserId;
  // Media albums render as bare collages (their own frames), unlike text/post
  // messages which sit in a tinted bubble.
  const isMedia = content?.type === "media";
  const [copied, setCopied] = useState(false);
  // Edit is a sender-only, time-boxed affordance. Computed at render so an
  // expired window stops offering an action the server would reject; a message
  // whose window lapses while mounted simply 409s and surfaces the error.
  const canEdit = mine && isWithinEditWindow(message.createdAt);
  // The peer avatar marks the end of a run, so it rides the last row (solo or
  // bottom); earlier rows reserve a same-width spacer to keep the column aligned.
  const showAvatar = !mine && (position === "solo" || position === "bottom");
  const roundingClasses = bubbleRoundingClasses(position, mine);

  // Only the last row of a peer group carries the avatar; earlier rows render a
  // same-width spacer so the bubbles stay aligned in one column. Built as a
  // variable so the JSX stays free of nested ternaries.
  let avatarNode: React.ReactNode = null;
  if (showAvatar) {
    avatarNode = (
      <UserAvatar avatarUrl={message.sender?.avatarUrl ?? null} size={28} />
    );
  } else if (!mine) {
    avatarNode = <span aria-hidden className="w-7 shrink-0" />;
  }

  const copyText = useCallback(async () => {
    let text = "";
    if (content?.type === "text") {
      text = content.content;
    } else if (content?.type === "post" || content?.type === "media") {
      text = content.content ?? "";
    }
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
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
        <>
          <p className="min-w-0 break-words whitespace-pre-wrap">
            {content.content}
            <EditedMarker
              editedAt={message.editedAt}
              mine={mine}
              onColoredBubble={onColoredBubble}
            />
          </p>
          <MessageLinkEmbed content={content.content} mine={mine} />
        </>
      );
    }
    if (content.type === "media") {
      return <MessageMediaAlbum content={content} messageId={message.id} />;
    }
    // Post share: an optional caption the sender typed, above the embed card.
    return (
      <>
        {content.content ? (
          <p className="mb-1 min-w-0 break-words whitespace-pre-wrap">
            {content.content}
          </p>
        ) : null}
        <PostEmbed postId={content.postId} mine={mine} />
      </>
    );
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
        <div
          className={cn(
            "text-muted-foreground/60 border-border/40 my-0.5 max-w-[85%] min-w-0 border border-dashed px-3.5 py-2 text-xs italic sm:max-w-[75%]",
            roundingClasses
          )}
        >
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

  // A bare media collage has no tint to sit on, so its reply quote brings its
  // own neutral surface; inside a bubble the quote is one step darker than the
  // bubble tint. Precomputed as plain strings to keep the JSX ternary-free.
  let quoteSurfaceClass = "bg-muted/40";
  if (isMedia) {
    quoteSurfaceClass = "border-border/50 bg-muted/50 border";
  } else if (mine) {
    quoteSurfaceClass = "bg-black/20";
  }

  let bubbleClass: string;
  if (isMedia) {
    // Media albums carry their own rounded frames, so they opt out of the
    // colored bubble entirely: no background, border, shadow, or padding.
    bubbleClass = "flex flex-col items-start text-sm";
  } else if (mine) {
    bubbleClass = cn(
      "px-3.5 py-2 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]",
      "bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
      // Corner shaping: the thread-edge corners tighten across a run's seams so
      // it reads as one block, while the inner corners stay round.
      roundingClasses
    );
  } else {
    bubbleClass = cn(
      "px-3.5 py-2 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]",
      "border-border/60 border bg-[hsl(var(--background))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
      roundingClasses
    );
  }
  const onColoredBubble = mine && !isMedia;

  // Both the resolved quote and its reserved placeholder share one box shape,
  // so the parent payload landing never changes this block's height.
  const quoteBoxClass = cn(
    "mb-1.5 flex items-center gap-2 overflow-hidden rounded-lg py-1.5 pr-2.5 pl-2 text-xs",
    quoteSurfaceClass
  );
  let quoteBlock: React.ReactNode = null;
  if (quote) {
    quoteBlock = (
      <div className={quoteBoxClass}>
        <MessageSquareQuote
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            onColoredBubble ? "text-white/70" : "text-muted-foreground"
          )}
        />
        <div className="min-w-0">
          <span
            className={cn(
              "block truncate font-semibold",
              onColoredBubble ? "text-white/90" : "text-foreground"
            )}
          >
            {quote.senderName}
          </span>
          <span
            className={cn(
              "block truncate",
              onColoredBubble ? "text-white/70" : "text-muted-foreground"
            )}
          >
            {quote.content}
          </span>
        </div>
      </div>
    );
  } else if (quotePending) {
    // Reserved space for a reply quote whose parent payload has not decrypted
    // yet; the same box means the parent landing does not re-measure the row.
    quoteBlock = (
      <div className={quoteBoxClass}>
        <MessageSquareQuote
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-50",
            onColoredBubble ? "text-white/70" : "text-muted-foreground"
          )}
        />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "block h-4 w-16 animate-pulse rounded",
              onColoredBubble ? "bg-white/25" : "bg-muted-foreground/20"
            )}
          />
          <span
            className={cn(
              "block h-4 w-3/4 animate-pulse rounded",
              onColoredBubble ? "bg-white/25" : "bg-muted-foreground/20"
            )}
          />
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
    >
      {/* A peer group shows one avatar on its last row; earlier rows keep a
          spacer of the same width so the bubbles never jump. */}
      {avatarNode}

      <div
        className={cn(
          "max-w-[85%] min-w-0 flex-col sm:max-w-[75%]",
          mine ? "items-end" : "items-start",
          "flex"
        )}
      >
        <div className="flex max-w-full min-w-0 items-end gap-1.5">
          {/* Desktop: inline actions revealed on hover/focus. Hidden in select
              mode so a click toggles the row instead of hitting an action, and
              the destructive action moved into the options menu. */}
          {selectionActive ? null : (
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
              {canEdit ? (
                <BubbleAction
                  ariaLabel="Edit message"
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={onEdit}
                />
              ) : null}
              <button
                aria-label="More options"
                className="text-muted-foreground hover:bg-muted/60 flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                data-open-options=""
                type="button"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Media albums carry their own rounded frames, so they opt out of
              the colored bubble entirely: no background, border, shadow, or
              padding. Text/post messages keep the tinted bubble. The data
              attribute is the stable anchor for the options pane. */}
          <div
            className={cn("relative max-w-full min-w-0", bubbleClass)}
            data-message-bubble=""
          >
            {quoteBlock}

            {renderContent()}

            {/* Text messages place the marker inline next to the timestamp (see
                renderContent); media albums and post cards have no timestamp
                row, so the marker sits just below the content instead. */}
            {content && content.type !== "text" ? (
              <EditedMarker
                editedAt={message.editedAt}
                mine={mine}
                onColoredBubble={onColoredBubble}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Centered time pill shown between message groups when the conversation
// pauses. Owned by the thread row so the divider and its spacing live with the
// grouping logic; the bubble stays purely about content.
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

// "Edited" marker with the edit time on hover/focus. Rendered only when the
// message actually carries an editedAt, so unedited bubbles are unchanged.
function EditedMarker({
  editedAt,
  mine,
  onColoredBubble,
}: {
  // Rows fetched over JSON carry ISO strings until revived; the realtime stream
  // revives them to Date. Both are accepted, and formatRelativeDate handles
  // either.
  editedAt: Date | string | null;
  mine: boolean;
  onColoredBubble: boolean;
}) {
  if (!editedAt) {
    return null;
  }
  const relative = formatRelativeDate(editedAt);
  // formatRelativeDate yields "just now" or a compact "5m"/"2h"/"Jan 5"; only
  // the compact forms read naturally with a trailing "ago". An unparseable
  // editedAt renders as "Invalid date", so fall back to the bare marker rather
  // than "Edited Invalid date ago".
  let label = "Edited";
  if (relative === "just now") {
    label = "Edited just now";
  } else if (relative !== "Invalid date") {
    label = `Edited ${relative} ago`;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "cursor-default pl-1.5 text-[10px] italic",
              mine && onColoredBubble
                ? "text-white/70"
                : "text-muted-foreground"
            )}
            type="button"
          >
            edited
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
