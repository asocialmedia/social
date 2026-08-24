"use client";

import type { UserData } from "@asm/db";
import type { Editor } from "@tiptap/core";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";

interface InlineSuggestionsProps {
  editor: Editor | null;
  onSelectMention: (user: UserData) => void;
  onSelectTag: (tag: string) => void;
  selectedMentionIds?: string[];
  selectedTagNames?: string[];
}

interface SuggestionState {
  left: number;
  query: string;
  top: number;
  type: "tag" | "mention";
}

const MAX_SUGGESTIONS = 6;
const TRIGGER_PATTERN = /(?:^|\s)(?<trigger>[#@])(?<query>[\w-]*)$/;
const MAX_TEXT_BEFORE = 50;
const EMPTY_IDS: string[] = [];

type SuggestionItem = string | UserData;

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), ms);
  };
}

interface SuggestionSearchers {
  discardPendingResponses: () => void;
  fetchTags: (query: string, excludedTags: string[]) => void;
  fetchUsers: (query: string, excludedUserIds: string[]) => void;
}

// Tag and user suggestion searches share one stale-response guard: firing a
// new query of either kind discards older in-flight responses, and closing
// the popover makes every pending response unobservable. Already-selected
// entries are passed in at call time so the searchers stay referentially
// stable without mirroring props into refs.
function createSuggestionSearchers(handlers: {
  setLoading: (loading: boolean) => void;
  setTags: (tags: string[]) => void;
  setUsers: (users: UserData[]) => void;
}): SuggestionSearchers {
  let activeQuery = "";

  const fetchTags = debounce(async (query: string, excludedTags: string[]) => {
    activeQuery = query;
    try {
      const res = await fetch(`/api/tags?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        if (activeQuery === query) {
          handlers.setLoading(false);
        }
        return;
      }
      const data = (await res.json()) as { tags: string[] };
      if (activeQuery !== query) {
        return;
      }
      handlers.setTags(
        data.tags
          .filter((tag) => !excludedTags.includes(tag))
          .slice(0, MAX_SUGGESTIONS)
      );
      if (activeQuery === query) {
        handlers.setLoading(false);
      }
    } catch {
      handlers.setTags([]);
      if (activeQuery === query) {
        handlers.setLoading(false);
      }
    }
  }, 250);

  const fetchUsers = debounce(
    async (query: string, excludedUserIds: string[]) => {
      activeQuery = query;
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(query)}`
        );
        if (!res.ok) {
          if (activeQuery === query) {
            handlers.setLoading(false);
          }
          return;
        }
        const data = (await res.json()) as { users: UserData[] };
        if (activeQuery !== query) {
          return;
        }
        handlers.setUsers(
          data.users
            .filter((user) => !excludedUserIds.includes(user.id))
            .slice(0, MAX_SUGGESTIONS)
        );
        if (activeQuery === query) {
          handlers.setLoading(false);
        }
      } catch {
        handlers.setUsers([]);
        if (activeQuery === query) {
          handlers.setLoading(false);
        }
      }
    },
    250
  );

  return {
    discardPendingResponses: () => {
      activeQuery = "";
    },
    fetchTags,
    fetchUsers,
  };
}

export const InlineSuggestions = ({
  editor,
  onSelectTag,
  onSelectMention,
  selectedMentionIds = EMPTY_IDS,
  selectedTagNames = EMPTY_IDS,
}: InlineSuggestionsProps) => {
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const { discardPendingResponses, fetchTags, fetchUsers } = useMemo(
    () =>
      createSuggestionSearchers({
        setLoading,
        setTags,
        setUsers,
      }),
    []
  );

  const close = useCallback(() => {
    setSuggestion(null);
    setTags([]);
    setUsers([]);
    discardPendingResponses();
  }, [discardPendingResponses]);

  const replaceTrigger = useCallback(
    (insertText: string) => {
      if (!editor) {
        return;
      }
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(
        Math.max(0, from - MAX_TEXT_BEFORE),
        from,
        "\n"
      );
      const match = textBefore.match(TRIGGER_PATTERN);
      const triggerStart = match
        ? from - match[0].length + (match[0].startsWith(" ") ? 1 : 0)
        : from;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: triggerStart, to: from }, insertText)
        .run();
    },
    [editor]
  );

  const selectTag = useCallback(
    (tag: string) => {
      replaceTrigger("");
      onSelectTag(tag);
      close();
    },
    [close, onSelectTag, replaceTrigger]
  );

  const selectMention = useCallback(
    (user: UserData) => {
      replaceTrigger("");
      onSelectMention(user);
      close();
    },
    [close, onSelectMention, replaceTrigger]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handler = () => {
      const { from, empty } = editor.state.selection;
      if (!empty) {
        setSuggestion(null);
        return;
      }
      const textBefore = editor.state.doc.textBetween(
        Math.max(0, from - MAX_TEXT_BEFORE),
        from,
        "\n"
      );
      const match = textBefore.match(TRIGGER_PATTERN);

      if (!match?.groups) {
        setSuggestion(null);
        return;
      }

      const { trigger, query: queryRaw } = match.groups;
      const triggerType = trigger === "#" ? "tag" : "mention";
      const query = queryRaw || "";
      const { view } = editor;
      const { dom } = view;
      const coords = view.coordsAtPos(from);
      const editorEl = dom.getBoundingClientRect();

      setSuggestion({
        left: coords.left - editorEl.left,
        query,
        top: coords.top - editorEl.top + 28,
        type: triggerType,
      });
      setActiveIndex(0);
      setLoading(true);
      if (triggerType === "tag") {
        fetchTags(query, selectedTagNames);
      } else {
        fetchUsers(query, selectedMentionIds);
      }
    };

    editor.on("update", handler);
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("update", handler);
      editor.off("selectionUpdate", handler);
    };
  }, [editor, fetchTags, fetchUsers, selectedMentionIds, selectedTagNames]);

  const handleItemSelect = useCallback(
    (item: SuggestionItem) => {
      if (suggestion?.type === "tag") {
        selectTag(item as string);
      } else if (suggestion?.type === "mention") {
        selectMention(item as UserData);
      }
    },
    [selectMention, selectTag, suggestion?.type]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!suggestion) {
        return;
      }
      const items = suggestion.type === "tag" ? tags : users;
      const { key } = e;
      if (key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key === "Enter" || key === "Tab") {
        const activeItem = items[activeIndex];
        if (activeItem) {
          e.preventDefault();
          handleItemSelect(activeItem);
        }
        return;
      }
      if (key === "Escape") {
        close();
      }
    },
    [activeIndex, close, handleItemSelect, suggestion, tags, users]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  const items: SuggestionItem[] = suggestion?.type === "tag" ? tags : users;

  const indexFromTarget = useCallback(
    (target: EventTarget | null): number =>
      Number((target as HTMLElement).closest("button")?.dataset.index),
    []
  );

  const handleListClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const index = indexFromTarget(e.target);
      const item = items[index];
      if (item !== undefined) {
        handleItemSelect(item);
      }
    },
    [handleItemSelect, items, indexFromTarget]
  );

  const handleListMouseOver = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const index = indexFromTarget(e.target);
      if (Number.isInteger(index)) {
        setActiveIndex(index);
      }
    },
    [indexFromTarget]
  );

  const handleListFocus = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const index = indexFromTarget(e.target);
      if (Number.isInteger(index)) {
        setActiveIndex(index);
      }
    },
    [indexFromTarget]
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter") {
        return;
      }
      const index = indexFromTarget(e.target);
      const item = items[index];
      if (item !== undefined) {
        handleItemSelect(item);
      }
    },
    [handleItemSelect, items, indexFromTarget]
  );

  if (!suggestion) {
    return null;
  }

  const activeId =
    suggestion.type === "tag" ? `sug-opt-${items[activeIndex]}` : undefined;

  const renderItem = (item: SuggestionItem, index: number) => {
    const isActive = index === activeIndex;
    const optionId =
      suggestion.type === "tag"
        ? `sug-opt-${item as string}`
        : `sug-opt-${(item as UserData).id}`;

    if (suggestion.type === "mention") {
      const user = item as UserData;
      return (
        <button
          aria-selected={isActive}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            isActive ? "bg-primary/10" : "hover:bg-muted/60"
          }`}
          data-index={index}
          id={optionId}
          key={user.id}
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox option needs button semantics
          role="option"
          type="button"
        >
          <UserAvatar avatarUrl={user.avatarUrl} className="h-6 w-6" />
          <span className="min-w-0 flex-1 truncate">
            <span className="block truncate font-medium">
              {user.displayName}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              @{user.username}
            </span>
          </span>
        </button>
      );
    }
    const tag = item as string;
    return (
      <button
        aria-selected={isActive}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
          isActive ? "bg-primary/10" : "hover:bg-muted/60"
        }`}
        data-index={index}
        id={optionId}
        key={tag}
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox option needs button semantics
        role="option"
        type="button"
      >
        <span className="text-primary">#</span>
        <span className="font-medium">{tag}</span>
      </button>
    );
  };

  const renderBody = () => {
    if (loading && items.length === 0) {
      return (
        <div className="flex items-center justify-center gap-2 p-3">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Searching...</span>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <p className="text-muted-foreground p-3 text-sm">
          {suggestion.type === "tag" ? "No matching tags" : "No matching users"}
        </p>
      );
    }
    return (
      <div
        aria-activedescendant={activeId}
        onClick={handleListClick}
        onFocus={handleListFocus}
        onKeyDown={handleListKeyDown}
        onMouseOver={handleListMouseOver}
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- combobox list container
        role="listbox"
        tabIndex={-1}
      >
        {items.map(renderItem)}
      </div>
    );
  };

  return (
    <div
      className="border-border bg-card absolute z-30 w-64 overflow-hidden rounded-xl border shadow-[0_0_0_1.5px_rgba(255,255,255,0.25),0_0_0_3.5px_hsl(var(--border)),0_8px_20px_rgba(0,0,0,0.25)]"
      style={{
        left: suggestion.left,
        top: suggestion.top,
      }}
    >
      <div className="max-h-64 overflow-y-auto">{renderBody()}</div>
    </div>
  );
};
