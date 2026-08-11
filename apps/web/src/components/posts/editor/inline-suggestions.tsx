"use client";

import type { UserData } from "@asm/db";
import type { Editor } from "@tiptap/core";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import UserAvatar from "@/components/layouts/user-avatar";

interface InlineSuggestionsProps {
  editor: Editor | null;
  onSelectMention: (user: UserData) => void;
  onSelectTag: (tag: string) => void;
}

interface SuggestionState {
  left: number;
  query: string;
  top: number;
  type: "tag" | "mention";
}

const MAX_SUGGESTIONS = 6;
const TRIGGER_PATTERN = /(?:^|\s)([#@])([\w-]*)$/;
const MAX_TEXT_BEFORE = 50;

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

export function InlineSuggestions({
  editor,
  onSelectTag,
  onSelectMention,
}: InlineSuggestionsProps) {
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchTags = useCallback(
    debounce(async (q: string) => {
      try {
        const res = await fetch(`/api/tags?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as { tags: string[] };
        const filtered = data.tags
          .filter((tag) => !selectedTagNames.includes(tag))
          .slice(0, MAX_SUGGESTIONS);
        setTags(filtered);
      } catch {
        setTags([]);
      } finally {
        setLoading(false);
      }
    }, 250),
    []
  );

  const fetchUsers = useCallback(
    debounce(async (q: string) => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as { users: UserData[] };
        const filtered = data.users
          .filter((user) => !selectedMentionIds.includes(user.id))
          .slice(0, MAX_SUGGESTIONS);
        setUsers(filtered);
      } catch {
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }, 250),
    []
  );

  const close = useCallback(() => {
    setSuggestion(null);
    setTags([]);
    setUsers([]);
  }, []);

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
      editor.chain().focus().insertContentAt(triggerStart, insertText).run();
    },
    [editor]
  );

  const selectTag = useCallback(
    (tag: string) => {
      replaceTrigger(`#${tag} `);
      onSelectTag(tag);
      setSelectedTagNames((prev) => [...prev, tag]);
      close();
    },
    [close, onSelectTag, replaceTrigger]
  );

  const selectMention = useCallback(
    (user: UserData) => {
      replaceTrigger(`@${user.username} `);
      onSelectMention(user);
      setSelectedMentionIds((prev) => [...prev, user.id]);
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

      if (!match) {
        setSuggestion(null);
        return;
      }

      const [, trigger, queryRaw] = match;
      const triggerType = trigger === "#" ? "tag" : "mention";
      const query = queryRaw || "";
      const { view } = editor;
      const { dom } = view;
      const coords = view.coordsAtPos(from);
      const editorEl = dom.getBoundingClientRect();

      setSuggestion({
        type: triggerType,
        query,
        top: coords.top - editorEl.top + 28,
        left: coords.left - editorEl.left,
      });
      setActiveIndex(0);
      setLoading(true);
      if (triggerType === "tag") {
        fetchTags(query);
      } else {
        fetchUsers(query);
      }
    };

    editor.on("update", handler);
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("update", handler);
      editor.off("selectionUpdate", handler);
    };
  }, [editor, fetchTags, fetchUsers]);

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

  const renderItem = (item: SuggestionItem, index: number) => {
    const isActive = index === activeIndex;

    if (suggestion.type === "mention") {
      const user = item as UserData;
      return (
        <button
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            isActive ? "bg-primary/10" : "hover:bg-muted/60"
          }`}
          data-index={index}
          key={user.id}
          type="button"
        >
          <UserAvatar avatarUrl={user.avatarUrl} className="h-6 w-6" />
          <span className="min-w-0 flex-1 truncate">
            <span className="block truncate font-medium">
              {user.displayName}
            </span>
            <span className="block truncate text-muted-foreground text-xs">
              @{user.username}
            </span>
          </span>
        </button>
      );
    }
    const tag = item as string;
    return (
      <button
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
          isActive ? "bg-primary/10" : "hover:bg-muted/60"
        }`}
        data-index={index}
        key={tag}
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
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground text-sm">Searching...</span>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <p className="p-3 text-muted-foreground text-sm">
          {suggestion.type === "tag" ? "No matching tags" : "No matching users"}
        </p>
      );
    }
    return (
      <div
        onClick={handleListClick}
        onFocus={handleListFocus}
        onKeyDown={handleListKeyDown}
        onMouseOver={handleListMouseOver}
        role="listbox"
        tabIndex={-1}
      >
        {items.map(renderItem)}
      </div>
    );
  };

  return (
    <div
      className="absolute z-30 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-[0_0_0_1.5px_rgba(255,255,255,0.25),0_0_0_3.5px_hsl(var(--border)),0_8px_20px_rgba(0,0,0,0.25)]"
      ref={containerRef}
      style={{
        top: suggestion.top,
        left: suggestion.left,
      }}
    >
      <div className="max-h-64 overflow-y-auto">{renderBody()}</div>
    </div>
  );
}
