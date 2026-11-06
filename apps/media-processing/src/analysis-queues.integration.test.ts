import { expect, test } from "bun:test";

import { Queue, QueueEvents, Worker } from "bullmq";

import { configureAnalysisQueues } from "./analysis-queues";
import { workerEnv } from "./env";

test("two worker replicas obey the same Redis concurrency and rate budget", async () => {
  const connection = { maxRetriesPerRequest: null, url: workerEnv.REDIS_URL };
  const name = `asm-safety-integration-${crypto.randomUUID()}`;
  const safety = new Queue(name, { connection });
  const analyze = new Queue(`${name}-analysis`, { connection });
  const events = new QueueEvents(name, { connection });
  let active = 0;
  let maximumActive = 0;
  const started: number[] = [];
  const run = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    started.push(Date.now());
    await Bun.sleep(25);
    active -= 1;
  };
  const first = new Worker(name, run, {
    autorun: false,
    concurrency: 4,
    connection,
  });
  const second = new Worker(name, run, {
    autorun: false,
    concurrency: 4,
    connection,
  });
  try {
    await configureAnalysisQueues({ analyze, externalSafety: safety });
    await events.waitUntilReady();
    const jobs = await safety.addBulk(
      Array.from({ length: 4 }, () => ({ data: {}, name: "assess" }))
    );
    const completions = jobs.map((job) => job.waitUntilFinished(events, 8000));
    void first.run();
    void second.run();
    await Promise.all(completions);
    expect(maximumActive).toBe(1);
    expect(started).toHaveLength(4);
    expect((started[2] ?? 0) - (started[0] ?? 0)).toBeGreaterThanOrEqual(900);
  } finally {
    await Promise.all([first.close(), second.close(), events.close()]);
    await Promise.all([
      safety.obliterate({ force: true }),
      analyze.obliterate({ force: true }),
    ]);
    await Promise.all([safety.close(), analyze.close()]);
  }
}, 15_000);
