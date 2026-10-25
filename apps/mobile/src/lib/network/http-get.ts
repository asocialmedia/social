const DEFAULT_TIMEOUT_MS = 15_000;

const inFlight = new Map<string, Promise<Response>>();
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

function removeInFlight(key: string, request: Promise<Response>): void {
  if (inFlight.get(key) === request) {
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
  options: { baseFetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new TypeError("getWithTimeout only supports GET requests");
  }
  const baseFetch = options.baseFetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const key = dedupeKey(input, { ...init, method }, baseFetch);
  const existing = inFlight.get(key);
  if (existing) {
    return cloneResponse(existing);
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
      return await Promise.race([
        baseFetch(input, { ...init, method: "GET", signal: controller.signal }),
        timeout,
      ]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  })();
  inFlight.set(key, request);
  // Cleanup is intentionally best effort and never changes the request result.
  void (async () => {
    try {
      await request;
      removeInFlight(key, request);
    } catch {
      removeInFlight(key, request);
    }
  })();
  return cloneResponse(request);
}
