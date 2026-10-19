type RequestResource = (
  url: string,
  options: { cache: "no-store"; signal: AbortSignal }
) => Promise<Response>;

export function loadCommunityChatResources<History, Threads>(
  {
    messagesUrl,
    threadsUrl,
    signal,
    onHistory,
    onHistoryError,
    onThreads,
    onThreadsError,
  }: {
    messagesUrl: string;
    threadsUrl: string;
    signal: AbortSignal;
    onHistory: (history: History) => void;
    onHistoryError: (status?: number) => void;
    onThreads: (threads: Threads) => void;
    onThreadsError: (status?: number) => void;
  },
  request: RequestResource = fetch
) {
  async function load<Resource>(
    url: string,
    onSuccess: (resource: Resource) => void,
    onError: (status?: number) => void
  ) {
    if (signal.aborted) {
      return;
    }
    try {
      const response = await request(url, { cache: "no-store", signal });
      if (signal.aborted) {
        return;
      }
      if (!response.ok) {
        if (!signal.aborted) {
          onError(response.status);
        }
        return;
      }
      const data = (await response.json()) as Resource;
      if (!signal.aborted) {
        onSuccess(data);
      }
    } catch {
      if (!signal.aborted) {
        onError();
      }
    }
  }
  return {
    history: load(messagesUrl, onHistory, onHistoryError),
    threads: load(threadsUrl, onThreads, onThreadsError),
  };
}
