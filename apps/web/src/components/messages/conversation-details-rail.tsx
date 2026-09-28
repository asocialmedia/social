"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";

import { ConversationDetailsBody } from "./conversation-details-panel";
import type { ConversationDetailsBodyProps } from "./conversation-details-panel";

export type ConversationDetailsRailProps = Omit<
  ConversationDetailsBodyProps,
  "asDialog" | "onClose"
>;

// The details pane that sits beside the transcript on a wide screen.
//
// Mounted only while it is open, rather than kept around at a collapsed width, and
// that is the point of folding it. The body is where the reads live: a paged read of
// the refs index, three cursors, and a request to the decryptor for the loaded
// window. A pane collapsed to a sliver is still a pane the user can see, so keeping
// the body mounted behind it would keep feeding a backfill walk and reading an index
// nobody is looking at -- work with a visible cost and no visible result. Folding
// unmounts the body, and the walk stops with it.
//
// Folded, the pane leaves the screen entirely: no strip, no handle. A 48px edge with
// its own expand control was a second copy of the control already in the thread
// header, and a permanently-visible stub of a pane nobody asked to see costs width
// in every conversation. The header's toggle is the one way back, and it is in the
// same place whichever way the pane is.
export function ConversationDetailsRail(props: ConversationDetailsRailProps) {
  return (
    // The same `hidden lg:flex` pair the online friends rail uses, so a viewport that
    // is momentarily narrower than the pane this replaces does not squeeze the
    // transcript. The mount is already gated on a `lg` media query, so this only
    // covers the frame between a resize and that query's listener.
    <aside className="bg-background border-border/60 hidden w-72 shrink-0 flex-col overflow-hidden border-l lg:flex xl:w-80">
      <ConversationDetailsBody {...props} />
    </aside>
  );
}

// The icon the header's toggle uses, so the button and the surface it controls
// cannot disagree about which way round they are.
export function DetailsRailToggleIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <PanelRightOpen className="size-4" />
  ) : (
    <PanelRightClose className="size-4" />
  );
}
