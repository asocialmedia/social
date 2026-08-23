"use client";

import type {
  SearchHistoryItem,
  SearchPostResult,
  SearchUserResult,
} from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";
import kyInstance from "@/lib/ky";

import { searchMutations } from "./mutations";

export function normalizeHistoryItem(
  item: SearchHistoryItem | string
): SearchHistoryItem {
  if (typeof item === "string") {
    try {
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        if (parsed.type === "user" && parsed.user) {
          return {
            raw: item,
            searchedAt:
              typeof parsed.searchedAt === "number"
                ? parsed.searchedAt
                : undefined,
            type: "user",
            user: parsed.user,
          };
        }
        if (parsed.type === "post" && parsed.post) {
          return {
            post: {
              ...parsed.post,
              createdAt: parsed.post.createdAt
                ? new Date(parsed.post.createdAt)
                : new Date(),
            },
            raw: item,
            searchedAt:
              typeof parsed.searchedAt === "number"
                ? parsed.searchedAt
                : undefined,
            type: "post",
          };
        }
        if (parsed.type === "query" && typeof parsed.query === "string") {
          return {
            query: parsed.query,
            raw: item,
            resultCount:
              typeof parsed.resultCount === "number"
                ? parsed.resultCount
                : undefined,
            searchedAt:
              typeof parsed.searchedAt === "number"
                ? parsed.searchedAt
                : undefined,
            type: "query",
          };
        }
      }
    } catch {
      // plain string query
    }
    return { query: item, raw: item, type: "query" };
  }
  return item;
}

export function useSearchHistory(enabled = true) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);

  const historyQuery = useQuery({
    enabled: enabled && isLoggedIn,
    queryFn: () =>
      kyInstance
        .get("/api/search", { searchParams: { type: "history" } })
        .json<SearchHistoryItem[]>(),
    queryKey: ["search-history"],
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const searchMutation = useMutation({
    mutationFn: searchMutations.addSearch,
    onError: (_err, _query, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(["search-history"], context.previousHistory);
      }
    },
    onMutate: async (
      payload: string | { query: string; resultCount?: number }
    ) => {
      await queryClient.cancelQueries({ queryKey: ["search-history"] });
      const previousHistory = queryClient.getQueryData<SearchHistoryItem[]>([
        "search-history",
      ]);

      const queryStr =
        typeof payload === "string" ? payload.trim() : payload.query.trim();
      const resultCount =
        typeof payload === "object" ? payload.resultCount : undefined;
      const normalized = queryStr.toLowerCase();
      const now = Date.now();
      const current = previousHistory ?? [];
      const filtered = current.filter((raw) => {
        const item = normalizeHistoryItem(raw);
        return !(
          item.type === "query" && item.query.toLowerCase() === normalized
        );
      });

      const optimisticItem: SearchHistoryItem = {
        query: queryStr,
        raw: JSON.stringify({
          query: queryStr,
          resultCount,
          searchedAt: now,
          type: "query",
        }),
        resultCount,
        searchedAt: now,
        type: "query",
      };

      queryClient.setQueryData<SearchHistoryItem[]>(
        ["search-history"],
        [optimisticItem, ...filtered].slice(0, 10)
      );

      return { previousHistory };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
      queryClient.invalidateQueries({ queryKey: ["search-suggestions"] });
    },
  });

  const addUserSearchMutation = useMutation({
    mutationFn: searchMutations.addUserSearch,
    onError: (_err, _user, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(["search-history"], context.previousHistory);
      }
    },
    onMutate: async (userPayload: SearchUserResult) => {
      await queryClient.cancelQueries({ queryKey: ["search-history"] });
      const previousHistory = queryClient.getQueryData<SearchHistoryItem[]>([
        "search-history",
      ]);

      const now = Date.now();
      const current = previousHistory ?? [];
      const filtered = current.filter((raw) => {
        const item = normalizeHistoryItem(raw);
        return !(item.type === "user" && item.user.id === userPayload.id);
      });

      const optimisticItem: SearchHistoryItem = {
        raw: JSON.stringify({
          searchedAt: now,
          type: "user",
          user: userPayload,
        }),
        searchedAt: now,
        type: "user",
        user: userPayload,
      };

      queryClient.setQueryData<SearchHistoryItem[]>(
        ["search-history"],
        [optimisticItem, ...filtered].slice(0, 10)
      );

      return { previousHistory };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
  });

  const addPostSearchMutation = useMutation({
    mutationFn: searchMutations.addPostSearch,
    onError: (_err, _post, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(["search-history"], context.previousHistory);
      }
    },
    onMutate: async (postPayload: SearchPostResult) => {
      await queryClient.cancelQueries({ queryKey: ["search-history"] });
      const previousHistory = queryClient.getQueryData<SearchHistoryItem[]>([
        "search-history",
      ]);

      const now = Date.now();
      const current = previousHistory ?? [];
      const filtered = current.filter((raw) => {
        const item = normalizeHistoryItem(raw);
        return !(item.type === "post" && item.post.id === postPayload.id);
      });

      const optimisticItem: SearchHistoryItem = {
        post: postPayload,
        raw: JSON.stringify({
          post: postPayload,
          searchedAt: now,
          type: "post",
        }),
        searchedAt: now,
        type: "post",
      };

      queryClient.setQueryData<SearchHistoryItem[]>(
        ["search-history"],
        [optimisticItem, ...filtered].slice(0, 10)
      );

      return { previousHistory };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
  });

  const removeHistoryItemMutation = useMutation({
    mutationFn: searchMutations.removeHistoryItem,
    onError: (_err, _target, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(["search-history"], context.previousHistory);
      }
    },
    onMutate: async (target: string) => {
      await queryClient.cancelQueries({ queryKey: ["search-history"] });
      const previousHistory = queryClient.getQueryData<SearchHistoryItem[]>([
        "search-history",
      ]);

      const current = previousHistory ?? [];
      const trimmedTarget = target.trim();
      const filtered = current.filter((raw) => {
        const item = normalizeHistoryItem(raw);
        const isMatch =
          (item.type === "query" &&
            (item.query === trimmedTarget ||
              item.query.toLowerCase() === trimmedTarget.toLowerCase())) ||
          (item.type === "user" &&
            (item.user.id === trimmedTarget ||
              item.user.username === trimmedTarget)) ||
          (item.type === "post" && item.post.id === trimmedTarget) ||
          item.raw === trimmedTarget;
        return !isMatch;
      });

      queryClient.setQueryData<SearchHistoryItem[]>(
        ["search-history"],
        filtered
      );

      return { previousHistory };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: searchMutations.clearHistory,
    onError: (_err, _variables, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(["search-history"], context.previousHistory);
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["search-history"] });
      const previousHistory = queryClient.getQueryData<SearchHistoryItem[]>([
        "search-history",
      ]);
      queryClient.setQueryData<SearchHistoryItem[]>(["search-history"], []);
      return { previousHistory };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["search-history"] });
    },
  });

  return {
    addPostSearchMutation,
    addSearchMutation: searchMutation,
    addUserSearchMutation,
    clearHistoryMutation,
    history: historyQuery.data ?? [],
    historyQuery,
    removeHistoryItemMutation,
  };
}
