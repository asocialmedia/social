import { setTimeout } from "node:timers/promises";

import { isStorageBucketMissing } from "@asm/media";

export async function retryProfileObjectRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isStorageBucketMissing(error) || signal.aborted) {
      throw error;
    }
    await setTimeout(250, undefined, { signal });
    return read();
  }
}
