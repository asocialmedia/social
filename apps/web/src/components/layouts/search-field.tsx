"use client";

import type {
  SearchPostResult,
  SearchSuggestion,
  SearchUserResult,
} from "@asm/db";
import { Input } from "@asm/ui/shadui/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpotlight } from "@/components/search/spotlight-provider";
import useDebounce from "@/hooks/use-debounce";
import kyInstance from "@/lib/ky";
import { searchMutations } from "../search/mutations";
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
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const debouncedInput = useDebounce(input, 300);

  const { data: suggestions } = useQuery({
    queryKey: ["search-suggestions", debouncedInput],
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
    enabled: Boolean(debouncedInput),
  });

  const { data: history } = useQuery({
    queryKey: ["search-history"],
    queryFn: async () =>
      kyInstance
        .get("/api/search", { searchParams: { type: "history" } })
        .json<string[]>(),
    enabled: open,
  });

  const { data: spotlight } = useQuery({
    queryKey: ["search-spotlight", debouncedInput],
    queryFn: (): Promise<SpotlightResponse> => {
      if (!debouncedInput) {
        return Promise.resolve({ posts: [], users: [] });
      }
      return kyInstance
        .get("/api/search/spotlight", {
          searchParams: { q: debouncedInput, limit: "4" },
        })
        .json<SpotlightResponse>();
    },
    enabled: open && Boolean(debouncedInput),
    staleTime: 15_000,
  });

  const searchMutation = useMutation({
    mutationFn: searchMutations.addSearch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: searchMutations.clearHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
  });

  const removeHistoryItemMutation = useMutation({
    mutationFn: searchMutations.removeHistoryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
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
      searchMutation.mutate(searchQuery.trim());
      openSpotlight(searchQuery.trim());
    },
    [onAfterSearch, openSpotlight, searchMutation]
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
    (query: string) => {
      removeHistoryItemMutation.mutate(query);
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
      router.push(`/users/${user.username}`);
    },
    [router]
  );

  const handleSelectPost = useCallback(
    (post: SearchPostResult) => {
      setOpen(false);
      router.push(`/posts/${post.id}`);
    },
    [router]
  );

  return (
    <div className="relative w-full max-w-md">
      <form className="relative" onSubmit={handleSubmit}>
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search on Asocialmedia"
          autoComplete="off"
          className="h-10 py-2.5 pr-4 pl-9 transition-all duration-300 ease-in-out focus-visible:ring-2 focus-visible:ring-primary"
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder="Search on Asocialmedia"
          ref={inputRef}
          type="text"
          value={input}
        />
      </form>

      {open && (input || (history && history.length > 0)) && (
        <div
          className="absolute left-1/2 z-205 mt-2 w-[min(90vw,28rem)] -translate-x-1/2 md:left-0 md:z-50 md:w-full md:translate-x-0"
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
