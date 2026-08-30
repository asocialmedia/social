"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { Hash, Loader2 } from "lucide-react";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

export interface CommentSuggestionsHandle {
  moveDown: () => void;
  moveUp: () => void;
  selectActive: () => boolean;
}

interface CommentSuggestionsProps {
  onClose: () => void;
  onSelectMention: (user: UserData) => void;
  onSelectTag: (tag: string) => void;
  query: string;
  type: "tag" | "mention";
}

const MAX_SUGGESTIONS = 6;

export const CommentSuggestions = forwardRef<
  CommentSuggestionsHandle,
  CommentSuggestionsProps
>(({ onClose, onSelectMention, onSelectTag, query, type }, ref) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    enabled: type === "tag",
    queryFn: async () => {
      const res = await kyInstance
        .get(`/api/tags?q=${encodeURIComponent(query)}`)
        .json<{ tags: string[] }>();
      return (res.tags ?? []).slice(0, MAX_SUGGESTIONS);
    },
    queryKey: ["comment-suggestions-tags", query],
    staleTime: 1000 * 30,
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    enabled: type === "mention" && query.trim().length > 0,
    queryFn: async () => {
      const res = await kyInstance
        .get(`/api/users/search?q=${encodeURIComponent(query)}`)
        .json<{ users: UserData[] }>();
      return (res.users ?? []).slice(0, MAX_SUGGESTIONS);
    },
    queryKey: ["comment-suggestions-users", query],
    staleTime: 1000 * 30,
  });

  const loading = type === "tag" ? tagsLoading : usersLoading;
  const items = type === "tag" ? tags : users;

  const handleSelect = useCallback(
    (item: string | UserData) => {
      if (type === "tag") {
        onSelectTag(item as string);
      } else {
        onSelectMention(item as UserData);
      }
    },
    [onSelectMention, onSelectTag, type]
  );

  useImperativeHandle(
    ref,
    () => ({
      moveDown: () => {
        if (items.length > 0) {
          setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
        }
      },
      moveUp: () => {
        if (items.length > 0) {
          setActiveIndex((prev) => Math.max(prev - 1, 0));
        }
      },
      selectActive: () => {
        if (items.length > 0 && items[activeIndex]) {
          handleSelect(items[activeIndex]);
          return true;
        }
        return false;
      },
    }),
    [activeIndex, handleSelect, items]
  );

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  if (
    !loading &&
    items.length === 0 &&
    (type === "tag" || query.trim().length > 0)
  ) {
    return (
      <div
        className="apple-panel absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-2xl p-2 shadow-[0_4px_20px_rgba(0,0,0,0.25)]"
        ref={containerRef}
      >
        <p className="text-muted-foreground p-2 text-center text-xs">
          {type === "tag" ? "No matching tags" : "No matching users"}
        </p>
      </div>
    );
  }

  if (items.length === 0 && !loading) {
    return null;
  }

  return (
    <div
      className="apple-panel absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-2xl p-1 shadow-[0_4px_20px_rgba(0,0,0,0.25)]"
      ref={containerRef}
    >
      {loading && items.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 p-3 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Searching...</span>
        </div>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {items.map((item, index) => {
            const isActive = index === activeIndex;
            if (type === "mention") {
              const user = item as UserData;
              return (
                <button
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-foreground hover:bg-muted/60"
                  )}
                  key={user.id}
                  onClick={() => handleSelect(user)}
                  onMouseEnter={() => setActiveIndex(index)}
                  type="button"
                >
                  <UserAvatar
                    avatarUrl={user.avatarUrl}
                    className="h-6 w-6 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="block truncate text-xs leading-tight font-medium">
                      {user.displayName}
                    </span>
                    <span className="text-muted-foreground block truncate text-[11px] leading-tight">
                      @{user.username}
                    </span>
                  </span>
                </button>
              );
            }
            const tag = item as string;
            return (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-foreground hover:bg-muted/60"
                )}
                key={tag}
                onClick={() => handleSelect(tag)}
                onMouseEnter={() => setActiveIndex(index)}
                type="button"
              >
                <span className="bg-primary/10 text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold">
                  <Hash className="size-3" />
                </span>
                <span className="truncate font-medium">#{tag}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

CommentSuggestions.displayName = "CommentSuggestions";
