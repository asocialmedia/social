"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";

import UserAvatar from "@/components/layouts/user/user-avatar";

import { ConversationDetailsBody } from "./conversation-details-panel";
import type { ConversationDetailsBodyProps } from "./conversation-details-panel";

export interface ConversationDetailsRailProps extends Omit<
  ConversationDetailsBodyProps,
  "asDialog" | "onClose"
> {
  // Whether the user has folded the pane to its edge. Desktop only -- the sheet has
  // its own dismissal, and a phone has no width to fold away.
  collapsed: boolean;
  onExpand: () => void;
}

// The details pane that sits beside the transcript on a wide screen, and the edge
// it folds down to.
//
// The two states are separate mounts rather than one component with a width, and
// that is the whole point of folding it. The body is where the reads live: a paged
// read of the refs index, three cursors, and a request to the decryptor for the
// loaded window. A pane collapsed to 48px is still a pane a user can see, so
// keeping the body mounted behind `display: none` would keep feeding a backfill
// walk and reading an index nobody is looking at -- work with a visible cost and
// no visible result. Folding drops the body, and the walk stops with it.
//
// The strip is a real control rather than a decorative edge, because the pane is
// not reachable from anywhere else once it is folded: the header's toggle is
// there too, but a 48px target that says what it is does not need the user to
// remember which icon they pressed.
export function ConversationDetailsRail({
  collapsed,
  onExpand,
  ...body
}: ConversationDetailsRailProps) {
  if (collapsed) {
    return (
      <CollapsedRail
        avatarUrl={body.peer?.avatarUrl ?? null}
        onExpand={onExpand}
      />
    );
  }

  return (
    // The same `hidden lg:flex` pair the online friends rail uses, so a viewport
    // that is momentarily narrower than the pane this one would replace does not
    // squeeze the transcript. The mount is already gated on a `lg` media query, so
    // this only covers the frame between a resize and that query's listener.
    <aside className="bg-background border-border/60 hidden w-72 shrink-0 flex-col overflow-hidden border-l lg:flex xl:w-80">
      <ConversationDetailsBody {...body} />
    </aside>
  );
}

// The folded pane: the peer's avatar and a chevron, on a strip the width of a
// header button. The avatar rather than an icon alone, so the edge reads as "that
// person's panel, folded" instead of an unexplained handle -- and it is the same
// image already in the thread header, so nothing is fetched.
function CollapsedRail({
  avatarUrl,
  onExpand,
}: {
  avatarUrl: string | null;
  onExpand: () => void;
}) {
  return (
    <aside className="bg-background border-border/60 hidden w-12 shrink-0 flex-col items-center border-l pt-2 lg:flex">
      <button
        aria-label="Show chat details"
        aria-expanded={false}
        className="icon-btn-3d flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        onClick={onExpand}
        title="Show chat details"
        type="button"
      >
        <UserAvatar avatarUrl={avatarUrl} size={28} />
      </button>
      {/* The chevron sits under the avatar rather than beside it: the strip is one
          button wide, and a second target in the same 48px would be a coin flip to
          hit. It is decorative -- the whole strip opens the pane -- so it is hidden
          from assistive technology rather than given a second name. */}
      <PanelRightOpen
        aria-hidden
        className="text-muted-foreground/60 mt-1.5 size-3.5 shrink-0"
      />
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
