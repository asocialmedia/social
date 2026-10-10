"use client";

import {
  Check,
  Copy,
  MessageSquareQuote,
  Pencil,
  Trash,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { placeOptionsPane } from "@/lib/messages/message-gestures";
import type { PaneRect } from "@/lib/messages/message-gestures";
import type { MessageReceiptInfo } from "@/lib/messages/message-receipts";
import { receiptLabel } from "@/lib/messages/message-receipts";
import { setPopupOpen } from "@/lib/popup-tracker";
import { cn, formatMessageDateTime } from "@/lib/utils";

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
  onSelect: () => void;
  /** Own-message delivery state; null for received messages. */
  receipt: MessageReceiptInfo | null;
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
  onSelect,
  preferEnd,
  presentation,
  receipt,
}: MessageOptionsMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
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
  }, [anchorRect, preferEnd, presentation]);

  // Publish the open state so outside-click dismissal elsewhere in the app (the
  // post card's navigation guard) can tell a menu dismissal from a real click.
  useEffect(() => {
    setPopupOpen(true);
    panelRef.current?.focus();
    return () => {
      setPopupOpen(false);
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
      window.addEventListener("scroll", onClose, true);
      window.addEventListener("resize", onClose);
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
        onClose();
      }
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(onFrame);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

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
        <div
          aria-label="Message options"
          className="panel-3d fixed inset-x-0 bottom-0 z-50 mx-2 mb-2 max-h-[80vh] overflow-y-auto rounded-2xl! p-2 text-sm outline-none"
          ref={panelRef}
          role="menu"
          style={{
            paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          }}
          tabIndex={-1}
        >
          <div className="bg-border/60 mx-auto mb-1.5 h-1 w-10 rounded-full" />
          {details}
          {actions}
        </div>
      </>,
      document.body
    );
  }

  return createPortal(
    <div
      aria-label="Message options"
      className="panel-3d fixed z-50 max-h-[calc(100vh-1rem)] w-56 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto rounded-2xl! p-2 text-sm outline-none"
      ref={panelRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
      tabIndex={-1}
    >
      {details}
      {actions}
    </div>,
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
      role="menuitem"
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}
