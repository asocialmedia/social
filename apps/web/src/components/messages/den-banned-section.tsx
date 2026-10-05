"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import type { DenBannedMember } from "@/lib/messages/client";
import {
  DEN_BAN_TERM,
  DEN_BANS_EMPTY,
  DEN_BANS_SUMMARY,
  denBanRowSubtitle,
} from "@/lib/messages/den-ban-copy";
import { cn } from "@/lib/utils";

// Who cannot come back to this den.
//
// Collapsed by default and inside the Members card rather than on its own page or as
// another filter tab. That placement is the whole UI decision: it is a moderation tool
// about the roster, so it belongs next to the roster, and it is almost always empty,
// so it must not be a top-level surface a reader scrolls past to get to the people
// they actually manage.
//
// Shown even when empty, as one slim row. A manager who never bans anybody should be
// able to find it, and the first time she needs it is the moment somebody asks her why
// a person she invited cannot get in. A section that only appears once it has content
// is a section she never learns exists.
export function DenBannedSection({
  bans,
  busyUserId,
  error,
  onUnban,
}: {
  bans: readonly DenBannedMember[];
  // Set when the list itself could not be read. It has to be said out loud, because the
  // alternative is a section reading "No banned members." for a manager whose read was
  // rate-limited or errored - an authoritative answer about who has been excluded, drawn
  // from a request that failed. That is the same class of lie as the anti-oracle work on
  // the join side: a wrong answer about who is kept out.
  error?: string | null;
  // The id being lifted right now, or null. Disables that row's button so a second
  // press cannot fire a duplicate request, and leaves the rest of the list usable.
  busyUserId: string | null;
  onUnban: (member: DenBannedMember) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-border/60 mt-2 border-t pt-2">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span className="text-sm font-medium">{DEN_BAN_TERM}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {bans.length}
        </span>
        {open ? (
          <ChevronDown
            aria-hidden
            className="text-muted-foreground ml-auto size-4"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="text-muted-foreground ml-auto size-4"
          />
        )}
      </button>
      <p className="text-muted-foreground mt-0.5 text-xs">{DEN_BANS_SUMMARY}</p>

      {open ? (
        <BannedList
          bans={bans}
          busyUserId={busyUserId}
          error={error}
          onUnban={onUnban}
        />
      ) : null}
    </div>
  );
}

// The rows, or the line that says there is nothing in here.
//
// Its own component rather than a second ternary nested inside the toggle: two
// ternaries deep reads as one question when it is two, and this one is answered by the
// list rather than by the toggle. It is also what lets the toggle stay a one-liner.
function BannedList({
  bans,
  busyUserId,
  error,
  onUnban,
}: {
  bans: readonly DenBannedMember[];
  busyUserId: string | null;
  error?: string | null;
  onUnban: (member: DenBannedMember) => void;
}) {
  // The error replaces the empty state rather than sitting beside it. Beside it, a
  // manager reading "No banned members." and a warning underneath would reasonably take
  // the first line as the answer.
  if (error) {
    return <p className="text-muted-foreground mt-2 text-xs">{error}</p>;
  }
  if (bans.length === 0) {
    return (
      <p className="text-muted-foreground mt-2 text-xs">{DEN_BANS_EMPTY}</p>
    );
  }
  return (
    <ul className="divide-border/60 mt-1.5 divide-y">
      {bans.map((ban) => (
        <DenBannedRow
          ban={ban}
          busy={busyUserId === ban.id}
          key={ban.id}
          onUnban={() => {
            onUnban(ban);
          }}
        />
      ))}
    </ul>
  );
}

// One person in the banned list. Its own component because the section around it is
// collapsed, so a row cannot be rendered by the section's own output without opening
// it - and `PickerRow` earns its own export for exactly the same reason.
//
// Exactly one action. A banned row is not a person to manage, promote or message - it
// is a record of a decision - so giving this row the roster's menu would invite a
// manager to try things that all fail.
export function DenBannedRow({
  ban,
  busy,
  onUnban,
}: {
  ban: DenBannedMember;
  // Whether THIS row's lift is in flight. Per-row rather than per-section so a manager
  // clearing a list of six is not locked out of the other five.
  busy: boolean;
  onUnban: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 py-2">
      <UserAvatar avatarUrl={ban.avatarUrl} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {ban.displayName ?? ban.username ?? "A former member"}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {denBanRowSubtitle(ban)}
        </span>
      </span>
      <button
        className={cn(
          "btn-3d-gray shrink-0 rounded-lg! px-2.5 py-1 text-xs font-medium",
          busy && "opacity-50"
        )}
        disabled={busy}
        onClick={onUnban}
        type="button"
      >
        {busy ? "Unbanning…" : "Unban"}
      </button>
    </li>
  );
}
