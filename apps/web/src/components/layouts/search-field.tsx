"use client";

import type {
  SearchPostResult,
  SearchSuggestion,
  SearchUserResult,
} from "@asm/db";
import { Input } from "@asm/ui/shadui/input";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSpotlight } from "@/components/search/spotlight-provider";
import { useSearchHistory } from "@/components/search/use-search-history";
import useDebounce from "@/hooks/use-debounce";
import kyInstance from "@/lib/ky";

import { SearchCommandList } from "../search/search-command-list";

interface SpotlightResponse {
  posts: SearchPostResult[];
  users: SearchUserResult[];
}

export default function SearchField({
  onAfterSearch,
}: {
  onAfterSearch?: () => void;
} = {}) {
  const router = useRouter();
  const { openSpotlight } = useSpotlight();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const debouncedInput = useDebounce(input, 300);

  const {
    addPostSearchMutation,
    addSearchMutation,
    addUserSearchMutation,
    clearHistoryMutation,
    history,
    removeHistoryItemMutation,
  } = useSearchHistory();

  const { data: suggestions } = useQuery({
    enabled: Boolean(debouncedInput),
    queryFn: () => {
      if (!debouncedInput) {
        return Promise.resolve([]);
      }
      return kyInstance
        .get("/api/search", {
          searchParams: { q: debouncedInput, type: "suggestions" },
        })
        .json<SearchSuggestion[]>();
    },
    queryKey: ["search-suggestions", debouncedInput],
  });

  const { data: spotlight } = useQuery({
    enabled: open && Boolean(debouncedInput),
    queryFn: (): Promise<SpotlightResponse> => {
      if (!debouncedInput) {
        return Promise.resolve({ posts: [], users: [] });
      }
      return kyInstance
        .get("/api/search/spotlight", {
          searchParams: { limit: "4", q: debouncedInput },
        })
        .json<SpotlightResponse>();
    },
    queryKey: ["search-spotlight", debouncedInput],
    staleTime: 15_000,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        commandRef.current &&
        !commandRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        return;
      }
      setOpen(false);
      onAfterSearch?.();
      addSearchMutation.mutate(searchQuery.trim());
      openSpotlight(searchQuery.trim());
    },
    [addSearchMutation, onAfterSearch, openSpotlight]
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSearch(input);
  };

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    setOpen(true);
  }, []);
  const handleFocus = useCallback(() => {
    setOpen(true);
  }, []);
  const handleClearHistory = useCallback(() => {
    clearHistoryMutation.mutate();
  }, [clearHistoryMutation]);
  const handleRemoveHistoryItem = useCallback(
    (target: string) => {
      removeHistoryItemMutation.mutate(target);
    },
    [removeHistoryItemMutation]
  );
  const handleSelectAction = useCallback(
    (value: string) => {
      setInput(value);
      handleSearch(value);
    },
    [handleSearch]
  );

  const handleSelectUser = useCallback(
    (user: SearchUserResult) => {
      setOpen(false);
      addUserSearchMutation.mutate(user);
      router.push(`/users/${user.username}`);
    },
    [addUserSearchMutation, router]
  );

  const handleSelectPost = useCallback(
    (post: SearchPostResult) => {
      setOpen(false);
      addPostSearchMutation.mutate(post);
      router.push(`/posts/${post.id}`);
    },
    [addPostSearchMutation, router]
  );

  return (
    <div className="relative w-full max-w-md">
      <form className="relative" onSubmit={handleSubmit}>
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          aria-label="Search on asocialmedia"
          autoComplete="off"
          className="focus-visible:ring-primary h-10 !bg-[hsl(var(--background-alt))] py-2.5 pr-4 pl-9 transition-all duration-300 ease-in-out focus-visible:ring-2"
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder="Search on asocialmedia"
          ref={inputRef}
          type="text"
          value={input}
        />
      </form>

      {open &&
        (input ||
          (history && history.length > 0) ||
          (suggestions && suggestions.length > 0)) && (
          <div
            className="absolute top-full left-1/2 z-50 mt-2 w-[min(92vw,30rem)] -translate-x-1/2 md:right-0 md:left-auto md:w-[30rem] md:translate-x-0"
            ref={commandRef}
          >
            <SearchCommandList
              history={history}
              input={input}
              onClearHistory={handleClearHistory}
              onRemoveHistoryItem={handleRemoveHistoryItem}
              onSelectPost={handleSelectPost}
              onSelectSuggestion={handleSelectAction}
              onSelectUser={handleSelectUser}
              posts={spotlight?.posts}
              suggestions={suggestions}
              users={spotlight?.users}
            />
          </div>
        )}
    </div>
  );
}
