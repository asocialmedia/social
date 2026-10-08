import type { SearchIndexStore } from "./search-index-format";
import type { SharedRefKind, SharedRefsPage } from "./shared-refs-format";

export interface ReadSharedRefsPageInput {
  after?: string;
  conversationId: string;
  kind: SharedRefKind;
  limit: number;
  serverReadPage?: (input: {
    after?: string;
    kind: SharedRefKind;
    signal: AbortSignal;
  }) => Promise<SharedRefsPage>;
  signal: AbortSignal;
  store: Pick<SearchIndexStore, "readSharedRefs"> | null;
}

export async function readSharedRefsPage(
  input: ReadSharedRefsPageInput
): Promise<{ page: SharedRefsPage; source: "local" | "server" }> {
  if (input.serverReadPage) {
    try {
      return {
        page: await input.serverReadPage({
          ...(input.after ? { after: input.after } : {}),
          kind: input.kind,
          signal: input.signal,
        }),
        source: "server",
      };
    } catch (error) {
      if (!input.store || input.signal.aborted) {
        throw error;
      }
    }
  }
  if (!input.store) {
    throw new Error("Shared items are temporarily unavailable");
  }
  return {
    page: await input.store.readSharedRefs(input.conversationId, input.kind, {
      ...(input.after ? { after: input.after } : {}),
      limit: input.limit,
    }),
    source: "local",
  };
}
