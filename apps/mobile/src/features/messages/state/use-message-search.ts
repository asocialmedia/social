import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import {
  hydrateSearchHits,
  MessagesApiError,
  searchConversationHistory,
} from "@/features/messages/lib/client";
import type { ConversationSearchPage } from "@/features/messages/lib/client";
import { decryptMessageWithBaseKey } from "@/features/messages/lib/crypto";
import type { DecryptEntry } from "@/features/messages/lib/decryptor";
import {
  extractSearchableText,
  rankSearchResults,
} from "@/features/messages/lib/message-search";
import type {
  SearchCandidate,
  SearchPage,
} from "@/features/messages/lib/message-search";
import type { TranscriptItem } from "@/features/messages/lib/transcript-rows";
import type { MessageData } from "@/features/messages/lib/types";
import { getApiBaseUrl } from "@/lib/api-env";
import { orderedCopy } from "@/lib/ordered-copy";

export function useMessageSearch({
  scope,
  conversationId,
  getBaseKeys,
  loadAround,
  open,
  onClose,
  foreground,
  messages,
  decrypted,
  items,
  scrollToIndex,
  scrollToOffset,
}: {
  scope: string | null;
  conversationId: string;
  getBaseKeys: (id: string) => Promise<Uint8Array[]>;
  loadAround: (id: string) => Promise<void>;
  open: boolean;
  onClose: () => void;
  foreground: boolean;
  messages: MessageData[];
  decrypted: ReadonlyMap<string, DecryptEntry | undefined>;
  items: TranscriptItem[];
  scrollToIndex: (index: number) => void;
  scrollToOffset: (offset: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [requestedPage, setRequestedPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [listView, setListView] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jump, setJump] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [result, setResult] = useState<{
    scope: string;
    query: string;
    index: number;
    cursor?: string;
    page: ConversationSearchPage;
    candidates: SearchCandidate[];
    messages: MessageData[];
  } | null>(null);
  const resultRef = useRef(result);
  const jumpTarget = useRef<{ id: string; attempts: number } | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setCommittedQuery(open ? query : "");
      setRequestedPage(0);
      setActiveId(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query]);
  useEffect(() => {
    const retryRevision = revision;
    if (
      retryRevision < 0 ||
      !open ||
      !foreground ||
      !scope ||
      committedQuery.trim().length < 2
    ) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPending(true);
      setError(null);
      setOffline(false);
      try {
        const previous = resultRef.current;
        let cursor: string | undefined;
        if (
          previous?.scope === scope &&
          previous.query === committedQuery &&
          requestedPage !== 0
        ) {
          cursor =
            requestedPage === previous.index
              ? previous.cursor
              : ((requestedPage > previous.index
                  ? previous.page.nextCursor
                  : previous.page.previousCursor) ?? undefined);
        }
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        const page = await searchConversationHistory(
          conversationId,
          { query: committedQuery, ...(cursor ? { cursor } : {}) },
          options,
          controller.signal
        );
        const hydrated = await hydrateSearchHits(
          conversationId,
          page.hits,
          options,
          controller.signal
        );
        const keys = await getBaseKeys(conversationId);
        const candidates: SearchCandidate[] = [];
        for (const message of hydrated.messages) {
          if (message.deletedAt) {
            continue;
          }
          for (const key of keys) {
            try {
              const payload = decryptMessageWithBaseKey(
                key,
                message.senderId,
                conversationId,
                message
              );
              candidates.push({
                createdAt: Date.parse(message.createdAt),
                id: message.id,
                text: extractSearchableText(payload).text,
              });
              break;
            } catch {
              // Try another readable epoch without inventing an empty result.
            }
          }
        }
        if (!controller.signal.aborted) {
          if (
            candidates.length !==
              hydrated.messages.filter((message) => !message.deletedAt)
                .length ||
            hydrated.deferredIds.length > 0 ||
            hydrated.unavailableIds.length > 0
          ) {
            setError("Some matches couldn't be loaded. Try again.");
          }
          setActiveId((current) =>
            candidates.some((candidate) => candidate.id === current)
              ? current
              : null
          );
          setResult({
            candidates,
            cursor,
            index: requestedPage,
            messages: hydrated.messages,
            page,
            query: committedQuery,
            scope,
          });
        }
      } catch (caughtError) {
        if (!controller.signal.aborted) {
          const denied =
            caughtError instanceof MessagesApiError &&
            (caughtError.status === 401 ||
              caughtError.status === 403 ||
              caughtError.status === 404);
          setOffline(!denied);
          setResult(null);
          setError(
            denied
              ? "You can no longer search this conversation."
              : "Couldn't search all messages. Showing saved messages on this device."
          );
        }
      }
      if (!controller.signal.aborted) {
        setPending(false);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- revision is the explicit retry channel
  }, [
    committedQuery,
    conversationId,
    foreground,
    getBaseKeys,
    open,
    requestedPage,
    revision,
    scope,
  ]);
  const valid =
    result?.scope === scope && result.query === committedQuery ? result : null;
  const localCandidates = useMemo(
    () =>
      messages.slice(-512).flatMap((message): SearchCandidate[] => {
        const payload = decrypted.get(message.id);
        if (
          message.deletedAt ||
          typeof payload !== "object" ||
          payload === null
        ) {
          return [];
        }
        return [
          {
            createdAt: Date.parse(message.createdAt),
            id: message.id,
            text: extractSearchableText(payload).text,
          },
        ];
      }),
    [decrypted, messages]
  );
  const candidates = valid?.candidates ?? (offline ? localCandidates : []);
  const ranked = orderedCopy(
    rankSearchResults(candidates, committedQuery),
    (left, right) => right.createdAt - left.createdAt
  );
  const pageIndex = valid?.index ?? 0;
  const page: SearchPage = {
    page: pageIndex,
    pageCount: pageIndex + (valid?.page.nextCursor ? 2 : 1),
    pageResults: ranked,
    rangeEnd: pageIndex * 20 + ranked.length,
    rangeStart: ranked.length ? pageIndex * 20 + 1 : 0,
  };
  const matchIds = ranked.map((entry) => entry.id);
  const scrollToTarget = useCallback(
    (id: string) => {
      const index = items.findIndex(
        (item) => item.kind === "message" && item.message.id === id
      );
      if (index !== -1) {
        scrollToIndex(index);
      }
    },
    [items, scrollToIndex]
  );
  useEffect(() => {
    const target = jumpTarget.current;
    if (!target) {
      return;
    }
    const timer = setTimeout(() => scrollToTarget(target.id), 50);
    return () => clearTimeout(timer);
  }, [scrollToTarget]);
  const handleJumpTo = useCallback(
    (id: string, dismissKeyboard = true) => {
      if (dismissKeyboard) {
        Keyboard.dismiss();
      }
      setListView(false);
      setActiveId(id);
      setJump((value) => value + 1);
      jumpTarget.current = { attempts: 0, id };
      const loaded = items.some(
        (item) => item.kind === "message" && item.message.id === id
      );
      if (loaded) {
        scrollToTarget(id);
      } else {
        const load = async () => {
          try {
            await loadAround(id);
          } catch {
            setError("Couldn't jump to this message. Try again.");
          }
        };
        void load();
      }
    },
    [items, loadAround, scrollToTarget]
  );
  const firstMatchId = ranked[0]?.id;
  useEffect(() => {
    if (!open || listView || activeId || !firstMatchId || pending) {
      return;
    }
    const timer = setTimeout(() => handleJumpTo(firstMatchId, false), 0);
    return () => clearTimeout(timer);
  }, [activeId, firstMatchId, handleJumpTo, listView, open, pending]);
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const target = jumpTarget.current;
      if (!target || target.attempts >= 3) {
        setError("Couldn't jump to this message. Try again.");
        return;
      }
      target.attempts += 1;
      scrollToOffset(Math.max(0, info.index * info.averageItemLength));
      if (jumpTimer.current) {
        clearTimeout(jumpTimer.current);
      }
      jumpTimer.current = setTimeout(() => scrollToTarget(target.id), 150);
    },
    [scrollToOffset, scrollToTarget]
  );
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
    setQuery("");
    setListView(false);
    setActiveId(null);
    setResult(null);
    setOffline(false);
    setError(null);
    jumpTarget.current = null;
    onClose();
  };
  const handleStep = (direction: 1 | -1) => {
    if (!matchIds.length) {
      return;
    }
    const index = activeId ? matchIds.indexOf(activeId) : -1;
    handleJumpTo(
      matchIds[(index + direction + matchIds.length) % matchIds.length],
      false
    );
  };
  const fullyCovered = valid?.page.coverage.complete === true && !error;
  let emptyLabel = "No matching messages";
  let statusLabel = ranked.length
    ? `${page.rangeStart}–${page.rangeEnd} matches`
    : "No matches";
  if (committedQuery.trim().length < 2) {
    emptyLabel = "Type at least 2 characters to search messages";
    statusLabel = "";
  } else if (pending) {
    emptyLabel = "Searching messages…";
    statusLabel = "Searching…";
  } else if (offline) {
    emptyLabel = "No matches in messages saved on this device";
    statusLabel = "Saved messages";
  } else if (error) {
    emptyLabel = error;
    statusLabel = "Try again";
  } else if (!fullyCovered) {
    emptyLabel =
      "Search isn't available for all of this history yet. Try again shortly.";
    statusLabel = ranked.length ? statusLabel : "Try again";
  }
  return {
    activeId,
    activePosition: activeId ? matchIds.indexOf(activeId) + 1 : 0,
    canIndexOlder: false,
    emptyLabel,
    error,
    fullyCovered,
    handleClose,
    handleIndexOlder: () => {
      resultRef.current = null;
      setRequestedPage(0);
      setRevision((value) => value + 1);
    },
    handleJumpTo,
    handleScrollToIndexFailed,
    handleStep,
    indexedCount: 0,
    indexingOlder: pending,
    jump,
    listView,
    matchCount: valid?.page.totalMatches ?? matchIds.length,
    page,
    query,
    resultMessages: valid?.messages ?? messages,
    setListView,
    setQuery,
    setRequestedPage,
    statusLabel,
  };
}
