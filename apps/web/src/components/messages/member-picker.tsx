"use client";

// The browser-safe subpath, not the `@asm/db` barrel. This is a client component
// and the barrel re-exports the queue and the logger, so a value import from it
// drags bullmq and pino into the browser bundle and the route fails to resolve
// `worker_threads`. `dens.ts` imports nothing at all, which is what makes it the
// one entry into this vocabulary a component may use.
import { GROUP_ADD_REFUSAL_COPY } from "@asm/db/messages/dens";
import { useQuery } from "@tanstack/react-query";
import { Check, History, Search, UserPlus, Users } from "lucide-react";
import { useMemo } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import {
  fetchConversationList,
  fetchGroupAddEligibility,
} from "@/lib/messages/client";
import { DEN_BAN_PICKER_REFUSAL } from "@/lib/messages/den-ban-copy";
import {
  toPickerRecipient,
  useMessageUserSearch,
} from "@/lib/messages/use-message-user-search";
import type { MessagePickerRecipient } from "@/lib/messages/use-message-user-search";
import { cn } from "@/lib/utils";

// The picker of messageable people, shared by the two places that need to
// choose accounts rather than send to one: creating a den, and adding people to
// an existing one.
//
// This is the multi-select shape of the share sheet's picker. It shares the
// search hook, the recents source and the row, so the three surfaces cannot
// drift on debounce timing, on what a failed search leaves behind, or on what a
// person without Messages enabled looks like. What differs is only what a tap
// does: the share sheet sends immediately, this marks a selection.
//
// The recents are people you already chat with, because a den roster is almost
// always drawn from people you already talk to. Anyone already excluded (a
// current member, when adding to an existing den) is filtered out here rather
// than disabled row by row, so a full den does not present five dead rows.
//
// A recent who will not accept a direct add is NOT filtered out. They are shown
// greyed with the reason, because the reader is likely looking for a specific
// person and an empty result tells them nothing about whether that person was
// found.

const RECENTS_MAX = 5;

// A recent before its group-add eligibility is known. The picker resolves that in
// one bulk read rather than carrying a policy in the conversation payload.
type RecentCandidate = Omit<MessagePickerRecipient, "addRefusal">;

export interface MemberPickerProps {
  // Ids that cannot be picked: the reader themselves, and (when adding) the
  // roster already in the den.
  excludeIds?: readonly string[];
  // Ids this den has banned, which cannot be picked but are still SHOWN and labelled.
  //
  // Shown rather than hidden, on purpose, and this is the one case that differs from
  // every other dead row in this picker. A person who is excluded because they are
  // already on the roster is filtered out, because the reader is not looking for them.
  // Somebody the reader is specifically trying to invite who turns out to be banned is a
  // different situation: they were found, and an empty result would say nothing about
  // why. So the row appears, greyed, with the reason attached.
  //
  // Optional because this picker is also the DEN CREATE dialog's, where there is no den
  // yet and therefore nobody to be banned from.
  bannedIds?: readonly string[];
  // A ceiling on the selection, so the picker cannot be used to propose a roster
  // the server will refuse. Null means the caller has no opinion.
  maxSelected?: number | null;
  onToggle: (member: MessagePickerRecipient) => void;
  // The picker's own query. Held by the caller beside `MemberPickerSearch`, so
  // the field and the list are two views of one value rather than two copies.
  query: string;
  selectedIds: readonly string[];
}

export function MemberPicker({
  bannedIds,
  excludeIds,
  maxSelected = null,
  onToggle,
  query,
  selectedIds,
}: MemberPickerProps) {
  const { user } = useSession();
  // Den context, always: this picker is only ever reached from a den, and the
  // whole point of it is that it can show somebody it will not let you pick.
  const { results, searching } = useMessageUserSearch(query, true, "den");

  const { data: conversations } = useQuery({
    enabled: Boolean(user),
    queryFn: () => fetchConversationList(),
    queryKey: ["message-share-recents", user?.id],
  });

  const excluded = useMemo(
    () => new Set([...(excludeIds ?? []), user?.id ?? ""]),
    [excludeIds, user?.id]
  );
  const banned = useMemo(() => new Set(bannedIds), [bannedIds]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Peers only, deduplicated across conversations: somebody in three chats is
  // one person to add to a den, not three rows.
  //
  // Split in two because eligibility is not in the conversation payload. These
  // are people you already talk to, which used to mean they were all addable -
  // that inference is exactly what the privacy setting removed, so the answer now
  // has to be asked for rather than assumed.
  const recentCandidates = useMemo((): RecentCandidate[] => {
    if (!user || !conversations) {
      return [];
    }
    const seen = new Set<string>();
    const people: RecentCandidate[] = [];
    for (const item of conversations.items) {
      for (const member of item.conversation.members) {
        if (member.userId === user.id || excluded.has(member.userId)) {
          continue;
        }
        if (seen.has(member.userId)) {
          continue;
        }
        seen.add(member.userId);
        people.push({
          avatarUrl: member.user.avatarUrl,
          displayName: member.user.displayName,
          // A roster from the conversation payload carries no identity flag, so
          // this stays unknown rather than guessed. The server refuses anybody
          // without one, and the row renders nothing extra for an unknown value.
          hasIdentity: true,
          id: member.userId,
          username: member.user.username,
        });
        if (people.length >= RECENTS_MAX) {
          return people;
        }
      }
    }
    return people;
  }, [conversations, excluded, user]);

  const recentIds = useMemo(
    () => recentCandidates.map((person) => person.id).toSorted(),
    [recentCandidates]
  );

  // One bulk read for the whole list rather than one per row. A person whose
  // answer has not arrived is shown as addable, which is the same posture the
  // search results take before their own fetch lands: the server has the final
  // say, so an optimistic row is a row that might refuse on submit, never one
  // that admits somebody it should not.
  const { data: recentsEligibility } = useQuery({
    enabled: recentIds.length > 0,
    queryFn: () => fetchGroupAddEligibility(recentIds),
    queryKey: ["den-add-eligibility", user?.id, recentIds],
  });

  const recents = useMemo(
    (): MessagePickerRecipient[] =>
      recentCandidates.map((person) => ({
        ...person,
        addRefusal: recentsEligibility?.[person.id] ?? null,
      })),
    [recentCandidates, recentsEligibility]
  );

  const isSearchMode = query.trim().length > 0;
  const atCeiling = maxSelected !== null && selectedIds.length >= maxSelected;

  function renderRow(person: MessagePickerRecipient) {
    const isSelected = selected.has(person.id);
    // Two independent reasons a row is dead, in the order the reader most likely
    // needs them.
    //
    // Somebody with no message identity cannot be wrapped for, so admitting them
    // would create a den they can see the name of and read none of. The route
    // refuses it; the picker refuses it first, and says why, because a row that
    // only fails after the tap teaches the reader nothing.
    //
    // Then their own group-add setting, which is the one this picker exists to
    // honour. Same reason for saying it out loud: a greyed row with no words is
    // indistinguishable from a control that is broken, and "they said no" is a
    // fact the reader is entitled to before they tap, not after they are refused.
    let unavailableReason: string | null = null;
    // A ban first, before the other two. The others are things the candidate chose or
    // has not finished setting up; a ban is a decision somebody else made about them,
    // and it is the only one of the three that no amount of the reader's own action
    // will clear. Putting it first also means the row's reason is the one that is
    // actually about them.
    if (banned.has(person.id)) {
      unavailableReason = DEN_BAN_PICKER_REFUSAL;
    } else if (person.hasIdentity === false) {
      unavailableReason = "hasn't enabled Messages";
    } else if (person.addRefusal !== null) {
      unavailableReason = GROUP_ADD_REFUSAL_COPY[person.addRefusal];
    }
    // At the ceiling every unselected row goes dead, which is the honest state:
    // the picker says how many the den can hold and refuses the rest. A row that
    // silently did nothing would read as a broken tap. A row that is already
    // picked stays live so it can be put back.
    const disabled = unavailableReason !== null || (!isSelected && atCeiling);
    return (
      <PickerRow
        disabled={disabled}
        key={person.id}
        onSelect={() => onToggle(person)}
        person={person}
        selected={isSelected}
        unavailableReason={unavailableReason}
      />
    );
  }

  if (isSearchMode) {
    // While the request is out, the previous query's people are still in state.
    // Painting them under a "Searching…" line reads as results for a query that has
    // not landed yet, so they are withheld until it does.
    if (searching) {
      return (
        <PickerFrame>
          <p className="text-muted-foreground px-2 py-2 text-xs">Searching…</p>
        </PickerFrame>
      );
    }
    if (results.length === 0) {
      return (
        <PickerFrame>
          <p className="text-muted-foreground px-2 py-2 text-xs">
            No one found. Try a different name.
          </p>
        </PickerFrame>
      );
    }
    return (
      <PickerFrame>
        {results.map((result) => {
          const person = toPickerRecipient(result);
          // A search can surface somebody the recents excluded (an existing
          // member, or the reader). They cannot be picked twice.
          if (excluded.has(person.id)) {
            return null;
          }
          return renderRow(person);
        })}
      </PickerFrame>
    );
  }

  if (recents.length === 0) {
    return (
      <PickerFrame>
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <Users className="text-muted-foreground/50 h-6 w-6" />
          <p className="text-muted-foreground max-w-56 px-2 text-xs">
            No conversations yet. Search for anyone to add them.
          </p>
        </div>
      </PickerFrame>
    );
  }

  return (
    <PickerFrame>
      {/* "message", because these are people you already talk to - which is not
          the same as people you may add. The list is recents, and it is now
          filtered by each person's own group-add setting rather than by your
          following list, so a row here can be greyed out. */}
      <p className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase">
        <History className="h-3 w-3" />
        People you message
      </p>
      {recents.map((person) => renderRow(person))}
    </PickerFrame>
  );
}

function PickerFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-h-72 flex-col overflow-y-auto">{children}</div>
  );
}

// One person in a picker. A real `<button>` with `aria-pressed`, so it is
// keyboard-operable and announces whether the person is already picked; the tick
// and the check are decoration on top of that, not the state itself.
export function PickerRow({
  disabled,
  onSelect,
  person,
  selected,
  unavailableReason,
}: {
  disabled?: boolean;
  onSelect: () => void;
  person: MessagePickerRecipient;
  selected?: boolean;
  // Why a row is dead, when being dead is not the reader's fault. Announced, not
  // only drawn: a greyed-out row with no words is indistinguishable from a
  // control that is broken.
  unavailableReason?: string | null;
}) {
  return (
    <button
      aria-pressed={selected ?? false}
      className={cn(
        "pill-3d-hover flex items-center gap-2.5 rounded-xl px-2 py-2 text-left",
        disabled && "cursor-not-allowed opacity-50"
      )}
      disabled={disabled ?? false}
      onClick={onSelect}
      type="button"
    >
      <UserAvatar avatarUrl={person.avatarUrl} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {person.displayName}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {unavailableReason
            ? `@${person.username} — ${unavailableReason}`
            : `@${person.username}`}
        </span>
      </span>
      {selected ? (
        <Check className="text-primary h-4 w-4 shrink-0" />
      ) : (
        <UserPlus className="text-muted-foreground h-4 w-4 shrink-0" />
      )}
    </button>
  );
}

// The search field that sits above a picker. Its own component because both
// den pickers need it and neither owns the query.
export function MemberPickerSearch({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="reels-input flex h-9 items-center gap-2 rounded-xl! px-3">
      <Search className="text-muted-foreground h-4 w-4 shrink-0" />
      <input
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </div>
  );
}
