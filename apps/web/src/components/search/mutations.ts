import type { SearchPostResult, SearchUserResult } from "@asm/db";

import kyInstance from "@/lib/ky";

export const searchMutations = {
  addPostSearch: async (post: SearchPostResult) => {
    try {
      return await kyInstance.post("/api/search", { json: { post } });
    } catch {
      return null;
    }
  },

  addSearch: async (
    payload: string | { query: string; resultCount?: number }
  ) => {
    try {
      const json =
        typeof payload === "string"
          ? { query: payload }
          : { query: payload.query, resultCount: payload.resultCount };
      return await kyInstance.post("/api/search", { json });
    } catch {
      // Guest or network failure should not surface as an unhandled rejection
      // in the UI — history is best-effort.
      return null;
    }
  },

  addUserSearch: async (user: SearchUserResult) => {
    try {
      return await kyInstance.post("/api/search", { json: { user } });
    } catch {
      return null;
    }
  },

  clearHistory: async () =>
    await kyInstance.delete("/api/search", {
      searchParams: { type: "history" },
    }),

  removeHistoryItem: async (target: string) =>
    await kyInstance.delete("/api/search", {
      searchParams: {
        target,
        type: "history",
      },
    }),
};
