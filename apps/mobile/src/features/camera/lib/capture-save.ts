export interface CaptureSaveResult {
  saved: boolean;
  reason?: "denied" | "failed";
}

// Concurrent handoffs of the same capture share one gallery write; a failed save can retry.
export function createCaptureSaver(
  persist: (uri: string) => Promise<CaptureSaveResult>
) {
  const saves = new Map<string, Promise<CaptureSaveResult>>();
  return (uri: string): Promise<CaptureSaveResult> => {
    const previous = saves.get(uri);
    if (previous) {
      return previous;
    }
    const pending = (async (): Promise<CaptureSaveResult> => {
      let result: CaptureSaveResult;
      try {
        result = await persist(uri);
      } catch {
        result = { reason: "failed", saved: false };
      }
      if (!result.saved) {
        saves.delete(uri);
      }
      return result;
    })();
    saves.set(uri, pending);
    if (saves.size > 12) {
      saves.delete(saves.keys().next().value ?? "");
    }
    return pending;
  };
}
