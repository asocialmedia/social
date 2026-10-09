import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";

import type { DecryptEntry } from "@/features/messages/lib/decryptor";
import {
  buildRankedResults,
  MAX_SEARCH_INDEX_MESSAGES,
  MIN_SEARCH_QUERY_LENGTH,
  paginateSearchResults,
  scoreSearchCandidates,
  scoredRowIdsNewestFirst,
  SEARCH_DEBOUNCE_MS,
} from "@/features/messages/lib/message-search";
import type { SearchCandidate } from "@/features/messages/lib/message-search";
import { collectSearchCorpus } from "@/features/messages/lib/search-corpus";
import type { SearchCorpus } from "@/features/messages/lib/search-corpus";
import type { TranscriptItem } from "@/features/messages/lib/transcript-rows";
import type { MessageData } from "@/features/messages/lib/types";

export function useMessageSearch({
  scope,
  open,
  onClose,
  foreground,
  messages,
  decrypted,
  items,
  loadOlder,
  loadingOlder,
  hasMoreOlder,
  historyError,
  scrollToIndex,
  scrollToOffset,
}: {
  scope: string | null;
  open: boolean;
  onClose: () => void;
  foreground: boolean;
  messages: MessageData[];
  decrypted: ReadonlyMap<string, DecryptEntry | undefined>;
  items: TranscriptItem[];
  loadOlder: () => void;
  loadingOlder: boolean;
  hasMoreOlder: boolean;
  historyError: string | null;
  scrollToIndex: (index: number) => void;
  scrollToOffset: (offset: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [corpus, setCorpus] = useState<SearchCorpus>({
    rows: new Map(),
    scope,
  });
  const scopedRows = useMemo(
    () =>
      corpus.scope === scope ? corpus.rows : new Map<string, SearchCandidate>(),
    [corpus, scope]
  );
  const [listView, setListView] = useState(false);
  const [requestedPage, setRequestedPage] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jump, setJump] = useState(0);
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);
  const pendingJump = useRef<{ id: string; attempts: number } | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCommittedQuery(open ? query : "");
      setRequestedPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  // Retain at most the web search budget in this mounted session's memory.
  // Payload cache eviction must not make an already searched result disappear.
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setCorpus({ rows: new Map(), scope });
        setWalking(false);
      }, 0);
      return () => clearTimeout(timer);
    }
    // oxlint-disable-next-line react/set-state-in-effect -- retain the external decrypt cache before its bounded eviction
    setCorpus((current) =>
      collectSearchCorpus(current, scope, messages, decrypted)
    );
  }, [decrypted, messages, open, scope]);

  const candidates = useMemo(() => [...scopedRows.values()], [scopedRows]);
  const scored = useMemo(
    () => scoreSearchCandidates(candidates, committedQuery),
    [candidates, committedQuery]
  );
  const matchIds = useMemo(() => scoredRowIdsNewestFirst(scored), [scored]);
  const ranked = useMemo(
    () => buildRankedResults(scored, committedQuery),
    [scored, committedQuery]
  );
  const page = paginateSearchResults(ranked, requestedPage);
  const activePosition = activeId ? matchIds.indexOf(activeId) + 1 : 0;
  const settled = messages.every(
    (message) =>
      message.deletedAt ||
      scopedRows.has(message.id) ||
      decrypted.get(message.id) === "error"
  );
  const fullyCovered =
    !hasMoreOlder &&
    settled &&
    !messages.some((message) => decrypted.get(message.id) === "error");
  const canIndexOlder =
    hasMoreOlder && scopedRows.size < MAX_SEARCH_INDEX_MESSAGES;

  useEffect(() => {
    if (
      !walking ||
      !open ||
      !foreground ||
      loadingOlder ||
      !canIndexOlder ||
      !settled ||
      historyError
    ) {
      return;
    }
    const timer = setTimeout(loadOlder, 0);
    return () => clearTimeout(timer);
  }, [
    canIndexOlder,
    foreground,
    historyError,
    loadOlder,
    loadingOlder,
    open,
    settled,
    walking,
  ]);

  const handleJumpTo = useCallback(
    (id: string, dismissKeyboard = true) => {
      const index = items.findIndex(
        (item) => item.kind === "message" && item.message.id === id
      );
      if (index === -1) {
        setJumpError("Couldn't find this message. Try again.");
        return;
      }
      if (dismissKeyboard) {
        Keyboard.dismiss();
      }
      setListView(false);
      setActiveId(id);
      setJumpError(null);
      setJump((value) => value + 1);
      pendingJump.current = { attempts: 0, id };
      if (jumpTimer.current) {
        clearTimeout(jumpTimer.current);
      }
      // Results cover the still-mounted transcript; dismiss before scrolling it.
      jumpTimer.current = setTimeout(() => {
        scrollToIndex(index);
      }, 0);
    },
    [items, scrollToIndex]
  );

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const target = pendingJump.current;
      if (!target || target.attempts >= 3) {
        setJumpError("Couldn't jump to this message. Try again.");
        return;
      }
      target.attempts += 1;
      scrollToOffset(Math.max(0, info.averageItemLength * info.index));
      if (jumpTimer.current) {
        clearTimeout(jumpTimer.current);
      }
      jumpTimer.current = setTimeout(() => {
        if (pendingJump.current !== target) {
          return;
        }
        const index = items.findIndex(
          (item) => item.kind === "message" && item.message.id === target.id
        );
        if (index !== -1) {
          scrollToIndex(index);
        }
      }, 150);
    },
    [items, scrollToIndex, scrollToOffset]
  );

  const autoJumpedQuery = useRef("");
  useEffect(() => {
    if (!open || query !== committedQuery || listView) {
      return;
    }
    if (!committedQuery.trim()) {
      autoJumpedQuery.current = "";
      return;
    }
    if (autoJumpedQuery.current === committedQuery || !matchIds[0]) {
      return;
    }
    const timer = setTimeout(() => {
      autoJumpedQuery.current = committedQuery;
      handleJumpTo(matchIds[0], false);
    }, 0);
    return () => clearTimeout(timer);
  }, [committedQuery, handleJumpTo, listView, matchIds, open, query]);

  useEffect(
    () => () => {
      if (jumpTimer.current) {
        clearTimeout(jumpTimer.current);
      }
    },
    []
  );

  const handleClose = () => {
    Keyboard.dismiss();
    pendingJump.current = null;
    if (jumpTimer.current) {
      clearTimeout(jumpTimer.current);
    }
    setWalking(false);
    setQuery("");
    setListView(false);
    setActiveId(null);
    setJumpError(null);
    autoJumpedQuery.current = "";
    onClose();
  };
  const handleStep = (direction: 1 | -1) => {
    if (!matchIds.length) {
      return;
    }
    const index = activeId ? matchIds.indexOf(activeId) : -1;
    let next = (index + direction + matchIds.length) % matchIds.length;
    if (index < 0) {
      next = direction > 0 ? 0 : matchIds.length - 1;
    }
    handleJumpTo(matchIds[next], false);
  };
  let emptyLabel =
    "No matches yet. Search older messages to cover more history.";
  if (committedQuery.trim().length < MIN_SEARCH_QUERY_LENGTH) {
    emptyLabel = "Type at least 2 characters to search messages";
  } else if (walking && canIndexOlder && !historyError) {
    emptyLabel = "Searching older messages…";
  } else if (historyError) {
    emptyLabel = "Couldn't load older messages. Try again.";
  } else if (fullyCovered) {
    emptyLabel = "No messages match this search";
  }
  return {
    activeId,
    activePosition,
    canIndexOlder,
    emptyLabel,
    error: jumpError ?? (walking ? historyError : null),
    fullyCovered,
    handleClose,
    handleIndexOlder: () => {
      setWalking(true);
      loadOlder();
    },
    handleJumpTo,
    handleScrollToIndexFailed,
    handleStep,
    indexedCount: scopedRows.size,
    indexingOlder: walking && canIndexOlder && !historyError && foreground,
    jump,
    listView,
    matchCount: matchIds.length,
    page,
    query,
    setListView,
    setQuery,
    setRequestedPage,
  };
}
