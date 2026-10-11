import { coverageRetryDelay } from "./coverage-retry-delay";

export interface ConversationReconciliationController {
  dispose: () => void;
  request: () => Promise<boolean>;
}

export function createConversationReconciliationController(input: {
  available: () => boolean;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  reconcile: (signal: AbortSignal) => Promise<boolean>;
  schedule?: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>;
}): ConversationReconciliationController {
  const schedule =
    input.schedule ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel =
    input.cancel ??
    ((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
  let disposed = false;
  let active: AbortController | null = null;
  let inFlight: Promise<boolean> | null = null;
  let pending = false;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function available(): boolean {
    try {
      return !disposed && input.available();
    } catch {
      return false;
    }
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      cancel(retryTimer);
      retryTimer = null;
    }
  }

  function retry(): void {
    if (!available() || retryTimer !== null) {
      return;
    }
    retryTimer = schedule(() => {
      retryTimer = null;
      void request();
    }, coverageRetryDelay(retryAttempt));
    retryAttempt = Math.min(retryAttempt + 1, 4);
  }

  async function reconcile(): Promise<boolean> {
    let succeeded = false;
    let passes = 0;
    // oxlint-disable no-await-in-loop -- replay requests coalesce into at most two sequential, bounded passes
    do {
      pending = false;
      if (!available()) {
        return false;
      }
      const controller = new AbortController();
      active = controller;
      try {
        succeeded = await input.reconcile(controller.signal);
      } catch {
        succeeded = false;
      }
      if (disposed || controller.signal.aborted) {
        return false;
      }
      active = null;
      passes += 1;
    } while (succeeded && pending && passes < 2);
    // oxlint-enable no-await-in-loop
    if (succeeded) {
      retryAttempt = 0;
    }
    return succeeded;
  }

  function request(): Promise<boolean> {
    if (!available()) {
      return Promise.resolve(false);
    }
    if (inFlight) {
      pending = true;
      return inFlight;
    }
    clearRetry();
    // Start after assigning inFlight so a synchronous callback cannot start another replay.
    async function completeRequest(): Promise<boolean> {
      await Promise.resolve();
      let succeeded = false;
      try {
        succeeded = await reconcile();
      } catch {
        succeeded = false;
      }
      if (inFlight === promise) {
        inFlight = null;
        if (!succeeded || pending) {
          retry();
        }
      }
      return succeeded;
    }
    const promise = completeRequest();
    inFlight = promise;
    return promise;
  }

  return {
    dispose() {
      disposed = true;
      pending = false;
      active?.abort();
      active = null;
      clearRetry();
    },
    request,
  };
}
