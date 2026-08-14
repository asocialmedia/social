import kyInstance from "@/lib/ky";

export const searchMutations = {
  addSearch: async (query: string) =>
    await kyInstance.post("/api/search", { json: { query } }),

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
