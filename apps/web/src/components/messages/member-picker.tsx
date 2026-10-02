"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, History, Search, UserPlus, Users } from "lucide-react";
import { useMemo } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { fetchConversationList } from "@/lib/messages/client";
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

const RECENTS_MAX = 5;

export interface MemberPickerProps {
  // Ids that cannot be picked: the reader themselves, and (when adding) the
  // roster already in the den.
  excludeIds?: readonly string[];
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
  excludeIds,
  maxSelected = null,
  onToggle,
  query,
  selectedIds,
}: MemberPickerProps) {
  const { user } = useSession();
  const { results, searching } = useMessageUserSearch(query);

  const { data: conversations } = useQuery({
    enabled: Boolean(user),
    queryFn: () => fetchConversationList(),
    queryKey: ["message-share-recents", user?.id],
  });

  const excluded = useMemo(
    () => new Set([...(excludeIds ?? []), user?.id ?? ""]),
    [excludeIds, user?.id]
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Peers only, deduplicated across conversations: somebody in three chats is
  // one person to add to a den, not three rows.
  const recents = useMemo((): MessagePickerRecipient[] => {
    if (!user || !conversations) {
      return [];
    }
    const seen = new Set<string>();
    const people: MessagePickerRecipient[] = [];
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

  const isSearchMode = query.trim().length > 0;
  const atCeiling = maxSelected !== null && selectedIds.length >= maxSelected;

  function renderRow(person: MessagePickerRecipient) {
    const isSelected = selected.has(person.id);
    // Somebody with no message identity cannot be wrapped for, so admitting them
    // would create a den they can see the name of and read none of. The route
    // refuses it; the picker refuses it first, and says why, because a row that
    // only fails after the tap teaches the reader nothing.
    const noIdentity = person.hasIdentity === false;
    // At the ceiling every unselected row goes dead, which is the honest state:
    // the picker says how many the den can hold and refuses the rest. A row that
    // silently did nothing would read as a broken tap.
    const disabled = noIdentity || (!isSelected && atCeiling);
    return (
      <PickerRow
        disabled={disabled}
        key={person.id}
        onSelect={() => onToggle(person)}
        person={person}
        selected={isSelected}
        unavailableReason={noIdentity ? "hasn't enabled Messages" : null}
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
            No one found. You can only add people you follow.
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
            No conversations yet. Search for someone you follow to add them.
          </p>
        </div>
      </PickerFrame>
    );
  }

  return (
    <PickerFrame>
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
