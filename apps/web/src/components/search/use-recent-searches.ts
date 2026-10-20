"use client";

import { useCallback, useRef, useState } from "react";

import {
  readRecentSearches,
  rememberSearch,
  rememberResult,
  recentSearchKey,
  readSearchCandidates,
  rememberCandidates,
} from "./spotlight-search";
import type {
  RecentSearch,
  SearchCandidate,
  SearchSource,
  SearchTarget,
} from "./spotlight-search";

function storedValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Search memory stays usable in this session when storage is unavailable.
  }
}

export function useRecentSearches(viewer: string) {
  const key = `asm:spotlight:history:${viewer}`;
  const candidateKey = `asm:spotlight:suggestions:${viewer}`;
  const [history, setHistory] = useState<RecentSearch[]>(() =>
    readRecentSearches(storedValue(key))
  );
  const [candidates, setCandidates] = useState(() =>
    readSearchCandidates(storedValue(candidateKey))
  );
  const historyRef = useRef(history);
  const candidatesRef = useRef(candidates);
  const updateHistory = (
    update: (current: RecentSearch[]) => RecentSearch[]
  ) => {
    const next = update(historyRef.current);
    historyRef.current = next;
    persist(key, next);
    setHistory(next);
  };
  const updateCandidates = useCallback(
    (update: (current: SearchCandidate[]) => SearchCandidate[]) => {
      const next = update(candidatesRef.current);
      candidatesRef.current = next;
      persist(candidateKey, next);
      setCandidates(next);
    },
    [candidateKey]
  );
  const collect = useCallback(
    (targets: SearchTarget[], query: string) => {
      updateCandidates((current) =>
        rememberCandidates(current, targets, query)
      );
    },
    [updateCandidates]
  );
  return {
    candidates,
    clear: () => {
      updateHistory(() => []);
      updateCandidates(() => []);
    },
    collect,
    history,
    remember: (query: string, source: SearchSource) =>
      updateHistory((current) => rememberSearch(current, query, source)),
    rememberResult: (target: SearchTarget, query: string) =>
      updateHistory((current) => rememberResult(current, target, query)),
    remove: (id: string) =>
      updateHistory((current) =>
        current.filter((entry) => recentSearchKey(entry) !== id)
      ),
  };
}
