import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

import {
  attachWorkerFailureReporting,
  runMessageSearchJob,
} from "./worker-lifecycle";

describe("BullMQ worker failure boundaries", () => {
  test("connection errors are handled without an unhandled EventEmitter error", async () => {
    const reported = Promise.withResolvers<Record<string, unknown>>();
    const worker = new Worker(
      `dm-worker-unavailable-${randomUUID()}`,
      async () => {},
      {
        connection: {
          connectTimeout: 100,
          host: "127.0.0.1",
          maxRetriesPerRequest: null,
          port: 1,
          retryStrategy: () => 50,
        },
      }
    );
    attachWorkerFailureReporting(worker, (fields) => {
      reported.resolve(fields);
    });
    try {
      const fields = await reported.promise;
      expect(fields.errorCode).toBe("ECONNREFUSED");
      expect(Object.keys(fields).toSorted()).toEqual(["errorCode", "queue"]);
      expect(worker.listenerCount("error")).toBeGreaterThan(0);
    } finally {
      await worker.close(true);
    }
  }, 5000);

  test("retries preserve processing capacity without persisting sensitive source errors", async () => {
    const queueName = `dm-worker-retry-${randomUUID()}`;
    const connection = new Redis(
      process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
      { maxRetriesPerRequest: null }
    );
    const queue = new Queue(queueName, { connection });
    const logs: { fields: Record<string, unknown>; message: string }[] = [];
    const finished = Promise.withResolvers<undefined>();
    let attempts = 0;
    const privateText = "private-message-and-search-fragment-7ab12";
    const worker = new Worker(
      queueName,
      () =>
        runMessageSearchJob(() => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error(privateText), {
              code: "23505",
              detail: privateText,
              query: privateText,
            });
          }
          return "indexed";
        }),
      { connection }
    );
    attachWorkerFailureReporting(worker, (fields, message) => {
      logs.push({ fields, message });
    });
    worker.on("completed", () => {
      finished.resolve();
    });
    try {
      await worker.waitUntilReady();
      const job = await queue.add(
        "index-identifiers",
        { outboxId: randomUUID() },
        { attempts: 2, backoff: { delay: 10, type: "fixed" } }
      );
      await finished.promise;
      const persisted = await queue.getJob(job.id ?? "");
      expect(persisted).toBeDefined();
      expect(attempts).toBe(2);
      expect(await persisted?.getState()).toBe("completed");
      expect(persisted?.failedReason).toBe(
        "Message search processing failed (23505)"
      );
      expect(persisted?.stacktrace?.join("\n")).not.toContain(privateText);
      expect(JSON.stringify(logs)).not.toContain(privateText);
      expect(
        logs.some(
          ({ fields }) =>
            fields.errorCode === "23505" && fields.attemptsMade === 1
        )
      ).toBe(true);
      const nextFinished = Promise.withResolvers<undefined>();
      worker.once("completed", () => {
        nextFinished.resolve();
      });
      await queue.add("index-identifiers", { outboxId: randomUUID() });
      await nextFinished.promise;
      expect(attempts).toBe(3);
    } finally {
      await worker.close(true);
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  }, 10_000);
});
