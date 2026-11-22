import {
  feedAuthorityExpirySeconds,
  feedAuthorityKeys,
  readJsonBounded,
} from "@asm/protocols/discovery";
import type { MediaFeedHealth } from "@asm/protocols/discovery";
import { z } from "zod";

const classifierResponse = z.object({
  queue: z.object({
    active: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
});

export async function readClassifierFeedHealth(
  url: string | undefined,
  token: string | undefined,
  fetcher = fetch
): Promise<Pick<MediaFeedHealth, "classifier" | "classifierQueued">> {
  if (!url || !token) {
    return { classifier: "unconfigured", classifierQueued: null };
  }
  try {
    const endpoint = new URL("/v1/model", url);
    const localHttp =
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1", "asmdev-classifier"].includes(
        endpoint.hostname
      );
    if (
      (endpoint.protocol !== "https:" && !localHttp) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new Error("Invalid classifier origin");
    }
    const signal = AbortSignal.timeout(900);
    const response = await fetcher(endpoint, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Classifier unavailable");
    }
    const { queue } = classifierResponse.parse(
      await readJsonBounded(response, 8192, signal)
    );
    return {
      classifier:
        queue.active > 0 && queue.waiting >= queue.limit ? "busy" : "ready",
      classifierQueued: queue.waiting,
    };
  } catch {
    return { classifier: "unavailable", classifierQueued: null };
  }
}

interface MediaHealthQueue {
  getJobs: (
    types: ("wait" | "prioritized")[],
    start: number,
    end: number,
    asc: boolean
  ) => Promise<{ timestamp: number }[]>;
  getWaitingCount: () => Promise<number>;
}

export function createMediaFeedPublisher(options: {
  classifierUrl?: string;
  classifierToken?: string;
  safety: MediaHealthQueue;
  enrichment: MediaHealthQueue;
  write: (
    key: string,
    value: string,
    unit: "EX",
    seconds: number
  ) => Promise<unknown>;
}) {
  return async () => {
    const [classifier, waiting, safety, enrichment] = await Promise.all([
      readClassifierFeedHealth(options.classifierUrl, options.classifierToken),
      options.safety.getWaitingCount(),
      options.safety.getJobs(["wait", "prioritized"], 0, 15, true),
      options.enrichment.getJobs(["wait", "prioritized"], 0, 15, true),
    ]);
    const observedAt = Date.now();
    const oldest = (jobs: { timestamp: number }[]) =>
      Math.max(0, ...jobs.map((job) => observedAt - job.timestamp));
    const report: MediaFeedHealth = {
      ...classifier,
      enrichmentOldestMs: oldest(enrichment),
      observedAt,
      safetyOldestMs: oldest(safety),
      safetyWaiting: waiting,
    };
    await options.write(
      feedAuthorityKeys.media,
      JSON.stringify(report),
      "EX",
      feedAuthorityExpirySeconds
    );
    return report;
  };
}
