"use client";

import type { GroupAddRefusal } from "@asm/db/messages/dens";
import { useEffect, useState } from "react";

import { searchMessageUsers } from "@/lib/messages/client";
import type { SearchUserResult } from "@/lib/messages/client";

// Debounced people search, shared by every surface that offers a picker of
// messageable accounts: the share sheet, the create-den dialog, and adding
// members to a den.
//
// Split out of the share sheet because the picker is the reusable part and the
// three call sites differ only in what a tap does afterwards. Duplicating this
// would mean three copies of the rules that actually matter: a superseded
// request must never overwrite a newer one's results, a failed search must not
// leave stale results on screen, and the idle case must clear rather than keep
// the last query's people visible.
//
// The timer is 250ms, which is short enough that the picker feels live and long
// enough that a fast typist fires one request instead of one per keystroke.
const SEARCH_DEBOUNCE_MS = 250;

// `enabled` is false while the surface is closed, so a picker that is mounted but
// hidden does not hold a search subscription.
export function useMessageUserSearch(
  query: string,
  enabled = true,
  // Which question the caller is asking. "den" widens the search past the
  // viewer's follows and brings back each candidate's group-add eligibility, so
  // the picker can grey out somebody the server would refuse instead of offering
  // a tap that fails after the fact. Everything else stays follow-only.
  context: "den" | "message" = "message"
): {
  results: SearchUserResult[];
  searching: boolean;
} {
  const trimmed = query.trim();
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!enabled || trimmed.length === 0) {
      // Deferred so the effect body never calls setState synchronously.
      const timer = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      // A failed search should not leave stale results behind; `found` starts
      // empty so the catch path clears the list below.
      let found: SearchUserResult[] = [];
      try {
        found = await searchMessageUsers(trimmed, context);
      } catch (error) {
        console.error("Message user search failed:", error);
      }
      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [context, enabled, trimmed]);

  return { results, searching };
}

// A recent recipient, as the pickers list them before anybody types. Structurally
// the fields `searchMessageUsers` returns, so a search result can be rendered by
// the same row as a recent without an adapter at each call site.
export interface MessagePickerRecipient {
  // Null when they may be added outright, or the reason they may not. Carried on
  // the recipient rather than derived at the row so the picker's dead rows and the
  // route's refusal are the same decision, read from one place.
  addRefusal: GroupAddRefusal | null;
  avatarUrl: string | null;
  displayName: string;
  id: string;
  hasIdentity: boolean;
  username: string;
}

// Adapts a search result to the recipient shape. Kept as a function rather than
// a structural coincidence so a new field on the search response cannot be read
// as present on a recent by accident.
export function toPickerRecipient(
  result: SearchUserResult
): MessagePickerRecipient {
  return {
    addRefusal: result.addRefusal,
    avatarUrl: result.avatarUrl,
    displayName: result.displayName,
    hasIdentity: result.hasIdentity,
    id: result.id,
    username: result.username,
  };
}
