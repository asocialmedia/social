import type { Worker } from "bullmq";

export function createWorkerPulse(
  task: () => Promise<void>,
  reportError: (error: unknown) => void
) {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  const run = (): Promise<void> => {
    if (disposed) {
      return Promise.resolve();
    }
    if (inFlight) {
      return inFlight;
    }
    const operation = (async () => {
      // Install the shared promise before invoking a task that can fail synchronously.
      await Promise.resolve();
      try {
        if (!disposed) {
          await task();
        }
      } catch (error) {
        try {
          reportError(error);
        } catch {
          // Observability failures must not break the next maintenance pulse.
        }
      } finally {
        inFlight = null;
      }
    })();
    inFlight = operation;
    return operation;
  };
  return {
    dispose: () => {
      disposed = true;
      return inFlight ?? Promise.resolve();
    },
    run,
  };
}

export function createWorkerShutdown(input: {
  drain: () => Promise<void>;
  scheduleDeadline?: (callback: () => void, timeoutMs: number) => () => void;
  stop: () => void;
  timeoutMs: number;
}) {
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 120_000
  ) {
    throw new RangeError(
      "Worker shutdown deadline must be between 1 and 120000 milliseconds"
    );
  }
  const scheduleDeadline =
    input.scheduleDeadline ??
    ((callback, timeoutMs) => {
      const timer = setTimeout(callback, timeoutMs);
      return () => clearTimeout(timer);
    });
  let shutdown: Promise<"drained" | "timed-out"> | null = null;
  return (): Promise<"drained" | "timed-out"> => {
    if (shutdown) {
      return shutdown;
    }
    shutdown = (async () => {
      // Fence repeated signals before invoking shutdown callbacks.
      await Promise.resolve();
      input.stop();
      const deadline = Promise.withResolvers<"timed-out">();
      const cancelDeadline = scheduleDeadline(
        () => deadline.resolve("timed-out"),
        input.timeoutMs
      );
      const drain = (async () => {
        await input.drain();
        return "drained" as const;
      })();
      try {
        return await Promise.race([deadline.promise, drain]);
      } finally {
        cancelDeadline();
      }
    })();
    return shutdown;
  };
}

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "EAI_AGAIN",
]);

export function messageWorkerErrorFields(error: unknown): {
  errorCode: string;
} {
  if (typeof error !== "object" || error === null) {
    return { errorCode: "UNKNOWN" };
  }
  const candidate = error as { code?: unknown; sqlState?: unknown };
  const code = candidate.sqlState ?? candidate.code;
  if (
    typeof code === "string" &&
    (CONNECTION_ERROR_CODES.has(code) ||
      /^(?:\d{2}[\dA-Z]{3}|XX\d{3}|P\d{4})$/.test(code))
  ) {
    return { errorCode: code };
  }
  return { errorCode: "UNKNOWN" };
}

export async function runMessageSearchJob<T>(
  task: () => T | Promise<T>
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const { errorCode } = messageWorkerErrorFields(error);
    // BullMQ persists failed reasons and stacks in Redis; never pass source errors to it.
    throw Object.assign(
      new Error(`Message search processing failed (${errorCode})`),
      { code: errorCode }
    );
  }
}

export function attachWorkerFailureReporting(
  worker: Worker,
  reportError: (fields: Record<string, unknown>, message: string) => void
): void {
  worker.on("error", (error) => {
    reportError(
      { ...messageWorkerErrorFields(error), queue: worker.name },
      "queue worker error"
    );
  });
  worker.on("failed", (job, error) => {
    // Error messages, SQL details and job payloads can contain sensitive search data.
    reportError(
      {
        ...messageWorkerErrorFields(error),
        attemptsMade: job?.attemptsMade,
        queue: worker.name,
      },
      "queue job failed"
    );
  });
}
