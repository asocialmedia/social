const DEFAULT_TIMEOUT_MS = 15_000;

interface SharedRequest {
  controller: AbortController;
  request: Promise<Response>;
  // Callers still waiting on this request.
  waiters: number;
}

const inFlight = new Map<string, SharedRequest>();
const fetchIds = new WeakMap<object, number>();
let nextFetchId = 1;

function fetchId(baseFetch: typeof fetch): number {
  const existing = fetchIds.get(baseFetch);
  if (existing) {
    return existing;
  }
  const id = nextFetchId;
  nextFetchId += 1;
  fetchIds.set(baseFetch, id);
  return id;
}

function dedupeKey(
  input: RequestInfo | URL,
  init: RequestInit,
  baseFetch: typeof fetch
): string {
  const url = typeof input === "string" ? input : input.toString();
  const headers = new Headers(init.headers);
  const headerEntries: [string, string][] = [];
  for (const [name, value] of headers.entries()) {
    let index = headerEntries.length;
    for (let scan = 0; scan < headerEntries.length; scan += 1) {
      if (name.localeCompare(headerEntries[scan][0]) < 0) {
        index = scan;
        break;
      }
    }
    headerEntries.splice(index, 0, [name, value]);
  }
  return `${fetchId(baseFetch)}:${init.method ?? "GET"}:${url}:${headerEntries
    .map(([name, value]) => `${name}=${value}`)
    .join("&")}`;
}

async function cloneResponse(request: Promise<Response>): Promise<Response> {
  const response = await request;
  return response.clone();
}

function removeInFlight(key: string, entry: SharedRequest): void {
  if (inFlight.get(key) === entry) {
    inFlight.delete(key);
  }
}

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`GET request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
  }
}

// Deduplicates only overlapping GETs. Responses are cloned per caller so
// parsing one result cannot consume the body for another caller.
export function getWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    baseFetch?: typeof fetch;
    timeoutMs?: number;
    readBody?: boolean;
  } = {}
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new TypeError("getWithTimeout only supports GET requests");
  }
  const baseFetch = options.baseFetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The caller's signal belongs to that caller, not to the shared request:
  // it is held back from the network call and settles only this caller.
  const { signal, ...shared } = init;
  const callerSignal = signal ?? undefined;
  if (callerSignal?.aborted) {
    return Promise.reject(abortReason(callerSignal));
  }
  const key = `${dedupeKey(input, { ...shared, method }, baseFetch)}:${timeoutMs}:${options.readBody ?? false}`;
  const existing = inFlight.get(key);
  if (existing) {
    return attachCaller(existing, callerSignal);
  }

  const controller = new AbortController();
  const request = (async () => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // oxlint-disable-next-line promise/avoid-new, promise/param-names -- A timeout needs an explicit reject path.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RequestTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    try {
      const read = async () => {
        const response = await baseFetch(input, {
          ...shared,
          method: "GET",
          signal: controller.signal,
        });
        if (!options.readBody) {
          return response;
        }
        // Buffer once before cloning so the deadline aborts the shared network
        // read, without leaving an unconsumed tee branch alive for each caller.
        const body = await response.arrayBuffer();
        return new Response(
          response.status === 204 || response.status === 304 ? null : body,
          {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText,
          }
        );
      };
      return await Promise.race([read(), timeout]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  })();
  const entry: SharedRequest = { controller, request, waiters: 0 };
  inFlight.set(key, entry);
  // Cleanup is intentionally best effort and never changes the request result.
  void (async () => {
    try {
      await request;
      removeInFlight(key, entry);
    } catch {
      removeInFlight(key, entry);
    }
  })();
  return attachCaller(entry, callerSignal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

// Joins one caller to a shared request. A caller with a signal leaves on
// abort and gets its own rejection; the network read is cancelled only when
// the last caller has left, so one screen unmounting never cancels the same
// read for another. A caller without a signal stays until the request ends.
function attachCaller(
  entry: SharedRequest,
  signal: AbortSignal | undefined
): Promise<Response> {
  entry.waiters += 1;
  const response = cloneResponse(entry.request);
  if (!signal) {
    return response;
  }
  // After this caller leaves, the shared read can still reject (it is
  // cancelled once nobody waits). That branch is consumed here so it never
  // surfaces as an unhandled rejection.
  void (async () => {
    try {
      await response;
    } catch {
      // Reported to the caller through the race below, or nobody is left.
    }
  })();
  let onAbort: (() => void) | null = null;
  // oxlint-disable-next-line promise/avoid-new -- an AbortSignal only reports through an event
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      entry.waiters -= 1;
      if (entry.waiters <= 0) {
        entry.controller.abort();
      }
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return (async () => {
    try {
      return await Promise.race([response, aborted]);
    } finally {
      if (onAbort && !signal.aborted) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  })();
}
