// Follow-eligible profile search that runs beside the global message search.
// Ported from the profile half of apps/web/src/components/messages/conversation-list.tsx:
// the same 250 ms debounce, 256 code point cap and retry deadline.

import { useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { searchMessageUsers } from "@/features/messages/lib/client";
import type { SearchUserResult } from "@/features/messages/lib/client";
import { isHistoryThrottled } from "@/features/messages/lib/history-throttle";
import { getApiBaseUrl } from "@/lib/network/api-env";

interface ProfileSearchState {
  attempt: number;
  error: string | null;
  query: string;
  results: SearchUserResult[];
  retryAt: number;
  status: "error" | "idle" | "loading" | "success";
}

const IDLE: ProfileSearchState = {
  attempt: 0,
  error: null,
  query: "",
  results: [],
  retryAt: 0,
  status: "idle",
};

export function useProfileSearch(rawQuery: string) {
  const query = rawQuery.trim();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProfileSearchState>(IDLE);
  const searchable = query.length > 0 && [...query].length <= 256;

  useEffect(() => {
    if (!searchable) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ ...IDLE, attempt, query, status: "loading" });
      try {
        const results = await searchMessageUsers(query, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (!cancelled) {
          setState({ ...IDLE, attempt, query, results, status: "success" });
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setState({
          ...IDLE,
          attempt,
          error: isHistoryThrottled(error)
            ? "Please wait a moment before searching again."
            : "Profiles could not be loaded.",
          query,
          retryAt: isHistoryThrottled(error)
            ? Date.now() + error.retryAfterSeconds * 1000
            : 0,
          status: "error",
        });
      }
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt, query, searchable]);

  // The React Compiler memoizes this callback on state.retryAt.
  const retry = () => {
    if (state.retryAt > Date.now()) {
      return;
    }
    setAttempt((value) => value + 1);
  };

  // A stale answer for an older query reads as loading for the new one, so the
  // list never shows profiles that do not match what is typed.
  const current: ProfileSearchState =
    searchable && state.query === query && state.attempt === attempt
      ? state
      : { ...IDLE, status: searchable ? "loading" : "idle" };
  return {
    error: current.error,
    loading: current.status === "loading",
    profiles: current.status === "success" ? current.results : [],
    retry,
    retryAt: current.retryAt,
  };
}
