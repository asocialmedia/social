import { AsyncLocalStorage } from "node:async_hooks";

import { BoundedReadQueue } from "@asm/protocols/discovery";

import { feedTiming } from "./feed-timing";

// Match foreground fan-in to the persona/database queues while absorbing a bounded navigation burst.
const foreground = new BoundedReadQueue({
  concurrency: 32,
  maxQueued: 1024,
  maxWaitMs: 10_000,
});

export async function admitFeedRead<T>(
  request: Request,
  read: () => Promise<T>
): Promise<T> {
  // A queued job is started by another reader's completion; keep Next's headers, cookies, and after callbacks in this request's context.
  const resumeRequest = AsyncLocalStorage.snapshot();
  const queued = feedTiming(request).start("queue");
  try {
    return await foreground.run(
      () =>
        resumeRequest(async () => {
          queued();
          return await read();
        }),
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
    );
  } finally {
    queued();
  }
}
