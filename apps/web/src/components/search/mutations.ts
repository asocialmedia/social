import kyInstance from "@/lib/ky";

export const searchMutations = {
  addSearch: async (query: string) => {
    try {
      return await kyInstance.post("/api/search", { json: { query } });
    } catch {
      // Guest or network failure should not surface as an unhandled rejection
      // in the UI — history is best-effort.
      return null;
    }
  },

  clearHistory: async () =>
    await kyInstance.delete("/api/search", {
      searchParams: { type: "history" },
    }),

  removeHistoryItem: async (query: string) =>
    await kyInstance.delete("/api/search", {
      searchParams: {
        query,
        type: "history",
      },
    }),
};
