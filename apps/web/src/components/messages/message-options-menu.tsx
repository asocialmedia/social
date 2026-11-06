"use client";

import { QUICK_MESSAGE_REACTIONS } from "@asm/messages";
import {
  Check,
  Copy,
  MessageSquareQuote,
  Pencil,
  Trash,
  Trash2,
  Plus,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { placeOptionsPane } from "@/lib/messages/message-gestures";
import type { PaneRect } from "@/lib/messages/message-gestures";
import type { MessageReceiptInfo } from "@/lib/messages/message-receipts";
import { receiptLabel } from "@/lib/messages/message-receipts";
import { setPopupOpen } from "@/lib/popup-tracker";
import { cn, formatMessageDateTime } from "@/lib/utils";

import { MessageReactionPicker } from "./message-reaction-picker";

// The options surface for one message. Desktop (fine pointers) open it as a
// popover beside the bubble; touch devices open it as a bottom sheet, where a
// side-anchored panel would be clamped onto the bubble on a narrow screen.
// Rendered once per open message as a portal — never in the virtualized flow —
// so the transcript's measurement is untouched.
//
// It carries the message details (sent/edited/receipt) alongside the actions,
// which is what replaced the always-on hover delete button.

export interface MessageOptionsMenuProps {
  /**
   * The target message's bubble rect in viewport coordinates (never the raw
   * pointer), so the pane always opens in the same place beside that message.
   */
  anchorRect: PaneRect;
  /** True for own (sender) messages: its pane sits to the LEFT of the bubble. */
  preferEnd: boolean;
  /** Bottom sheet on touch devices, side popover on fine pointers. */
  presentation: "popover" | "sheet";
  /** Whether this message is still inside the edit window (own messages only). */
  canEdit: boolean;
  createdAt: Date | string;
  editedAt: Date | string | null;
  /** Whether "Delete for everyone" applies (own, not already deleted). */
  canDeleteForEveryone: boolean;
  onClose: () => void;
  onCopy: () => void;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
  onEdit: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  reactionPending?: boolean;
  onSelect: () => void;
  /** Own-message delivery state; null for received messages. */
  receipt: MessageReceiptInfo | null;
  reactionOnly?: boolean;
}

export function MessageOptionsMenu({
  anchorRect,
  canDeleteForEveryone,
  canEdit,
  createdAt,
  editedAt,
  onClose,
  onCopy,
  onDeleteForEveryone,
  onDeleteForMe,
  onEdit,
  onReply,
  onReact,
  reactionPending = false,
  onSelect,
  preferEnd,
  presentation,
  receipt,
  reactionOnly = false,
}: MessageOptionsMenuProps) {
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keyboardViewport, setKeyboardViewport] = useState<{
    bottom: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (presentation !== "sheet") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const place = () => {
      if (viewport) {
        setKeyboardViewport({
          bottom: Math.max(
            0,
            window.innerHeight - viewport.height - viewport.offsetTop
          ),
          height: viewport.height,
        });
      }
    };
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [presentation]);
  // The sheet variant is positioned by CSS against the viewport, so it needs no
  // measured placement; the popover starts at a best-effort point and is placed
  // after measuring.
  const [position, setPosition] = useState({
    x: anchorRect.left,
    y: anchorRect.top,
  });

  // Measure once after mount, then place beside the bubble: preferred side when
  // it fits, flipped side when it does not, and finally clamped so it can never
  // overshoot the viewport on any edge. Layout effect so the panel never paints
  // at an overflowing position first.
  useLayoutEffect(() => {
    if (presentation !== "popover") {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const place = () => {
      const size = panel.getBoundingClientRect();
      const next = placeOptionsPane({
        preferEnd,
        rect: anchorRect,
        size: { height: size.height, width: size.width },
        viewport: { height: window.innerHeight, width: window.innerWidth },
      });
      // Bail when unchanged: the parent re-renders often and a fresh position
      // object each time would churn the panel needlessly.
      setPosition((current) =>
        current.x === next.x && current.y === next.y ? current : next
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [anchorRect, preferEnd, presentation]);

  // Publish the open state so outside-click dismissal elsewhere in the app (the
  // post card's navigation guard) can tell a menu dismissal from a real click.
  useEffect(() => {
    const previousFocus = document.activeElement;
    setPopupOpen(true);
    panelRef.current?.focus();
    return () => {
      setPopupOpen(false);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // Dismiss on Escape, outside pointerdown, scroll, or resize. The listener is
  // attached on the next frame so the very click/right-click that opened this
  // menu cannot immediately close it.
  useEffect(() => {
    let disposed = false;
    const onFrame = requestAnimationFrame(() => {
      if (disposed) {
        return;
      }
      document.addEventListener("pointerdown", handlePointerDown, true);
      document.addEventListener("keydown", handleKeyDown);
      window.addEventListener("scroll", handleScroll, true);
      if (presentation === "popover") {
        window.addEventListener("resize", onClose);
      }
    });

    function handlePointerDown(event: PointerEvent) {
      const panel = panelRef.current;
      if (
        panel &&
        event.target instanceof Node &&
        panel.contains(event.target)
      ) {
        return;
      }
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (pickerOpen) {
          setPickerOpen(false);
          requestAnimationFrame(() =>
            panelRef.current
              ?.querySelector<HTMLButtonElement>("[data-more-reactions]")
              ?.focus()
          );
        } else {
          onClose();
        }
      }
      if (event.key === "Tab") {
        const buttons = [
          ...(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,[tabindex="0"]'
          ) ?? []),
        ];
        const first = buttons?.[0];
        const last = buttons.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panelRef.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    function handleScroll(event: Event) {
      if (
        event.target instanceof Node &&
        panelRef.current?.contains(event.target)
      ) {
        return;
      }
      onClose();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(onFrame);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, pickerOpen, presentation]);

  const sentLabel = formatMessageDateTime(createdAt);
  const editedLabel = editedAt ? formatMessageDateTime(editedAt) : "";
  // The read/delivered watermark time, shown beside the status. Falls back to
  // the bare label when the watermark is unknown (pre-feature history).
  let receiptText = "";
  if (receipt) {
    const receiptTime = receipt.at ? formatMessageDateTime(receipt.at) : "";
    receiptText = receiptTime
      ? `${receiptLabel(receipt.status)} · ${receiptTime}`
      : receiptLabel(receipt.status);
  }

  const details = (
    <div className="border-border/50 mb-1 space-y-0.5 border-b px-2 pt-1 pb-2">
      {sentLabel ? (
        <p className="text-muted-foreground text-xs">
          Sent <span className="text-foreground/80">{sentLabel}</span>
        </p>
      ) : null}
      {editedLabel ? (
        <p className="text-muted-foreground text-xs">
          Edited <span className="text-foreground/80">{editedLabel}</span>
        </p>
      ) : null}
      {receiptText ? (
        <p className="text-muted-foreground text-xs">{receiptText}</p>
      ) : null}
    </div>
  );

  const actions = (
    <>
      <div
        className={cn(
          "px-1 py-1",
          !reactionOnly && "border-border/40 mb-1 border-b pb-2"
        )}
      >
        <fieldset
          aria-label="Choose a reaction"
          className="grid grid-cols-6 gap-1 border-0 p-0"
        >
          <legend className="sr-only">Choose a reaction</legend>
          {QUICK_MESSAGE_REACTIONS.map((emoji) => (
            <button
              aria-label={`React with ${emoji}`}
              className="hover:bg-muted/70 focus-visible:ring-primary/50 flex min-h-11 items-center justify-center rounded-xl text-2xl transition-[background-color,transform] duration-150 focus-visible:ring-2 motion-safe:active:scale-90"
              disabled={reactionPending}
              key={emoji}
              onClick={() => onReact(emoji)}
              type="button"
            >
              {emoji}
            </button>
          ))}
          <button
            aria-label="More reactions"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-primary flex min-h-11 items-center justify-center rounded-xl focus-visible:ring-2"
            data-more-reactions=""
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <span className="border-border/80 flex size-8 items-center justify-center rounded-full border border-dashed">
              <Plus className="size-4" />
            </span>
          </button>
        </fieldset>
      </div>
      {reactionOnly ? null : (
        <>
          <MenuRow
            icon={<Copy className="size-4" />}
            label="Copy"
            onSelect={onCopy}
          />
          <MenuRow
            icon={<MessageSquareQuote className="size-4" />}
            label="Reply"
            onSelect={onReply}
          />
          {canEdit ? (
            <MenuRow
              icon={<Pencil className="size-4" />}
              label="Edit"
              onSelect={onEdit}
            />
          ) : null}
          <MenuRow
            icon={<Check className="size-4" />}
            label="Select"
            onSelect={onSelect}
          />
          <MenuRow
            destructive
            icon={<Trash2 className="size-4" />}
            label="Delete for me"
            onSelect={onDeleteForMe}
          />
          {canDeleteForEveryone ? (
            <MenuRow
              destructive
              icon={<Trash className="size-4" />}
              label="Delete for everyone"
              onSelect={onDeleteForEveryone}
            />
          ) : null}
        </>
      )}
    </>
  );

  const content = pickerOpen ? (
    <MessageReactionPicker
      disabled={reactionPending}
      onBack={() => setPickerOpen(false)}
      onReact={onReact}
    />
  ) : (
    <>
      {reactionOnly ? null : details}
      {actions}
    </>
  );

  if (presentation === "sheet") {
    // Touch: a bottom sheet pinned to the viewport. It can never overshoot
    // horizontally, honors the home-indicator safe area, and scrolls if the
    // content outgrows a short screen.
    return createPortal(
      <>
        <div
          aria-hidden
          className="motion-safe:animate-in motion-safe:fade-in fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
        <dialog
          aria-label="Message options"
          className="panel-3d fixed inset-x-0 bottom-0 z-50 mx-auto mb-2 max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-sm overflow-y-auto rounded-2xl! p-3 text-sm outline-none"
          ref={panelRef}
          open
          aria-modal="true"
          style={{
            bottom: keyboardViewport?.bottom,
            maxHeight: keyboardViewport
              ? keyboardViewport.height - 16
              : undefined,
            paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          }}
          tabIndex={-1}
        >
          <div className="bg-border/60 mx-auto mb-1.5 h-1 w-10 rounded-full" />
          {content}
        </dialog>
      </>,
      document.body
    );
  }

  return createPortal(
    <dialog
      aria-label="Message options"
      className="panel-3d fixed z-50 m-0 max-h-[calc(100dvh-1rem)] w-80 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto rounded-2xl! p-2 text-sm outline-none"
      ref={panelRef}
      open
      style={{ left: position.x, top: position.y }}
      tabIndex={-1}
    >
      {content}
    </dialog>,
    document.body
  );
}

function MenuRow({
  destructive = false,
  icon,
  label,
  onSelect,
}: {
  destructive?: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "pill-3d-hover flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left sm:min-h-9",
        destructive && "text-destructive"
      )}
      onClick={onSelect}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}
