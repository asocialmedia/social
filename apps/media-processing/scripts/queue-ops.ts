import {
  closePrisma,
  closeQueueConnections,
  getQueue,
  redis,
  MEDIA_ANALYZE_QUEUE,
  MEDIA_PROCESS_QUEUE,
  MEDIA_SCAN_QUEUE,
} from "@asm/db";

const names = {
  analyze: MEDIA_ANALYZE_QUEUE,
  process: MEDIA_PROCESS_QUEUE,
  scan: MEDIA_SCAN_QUEUE,
};
const [action = "inspect", lane = "analyze", jobId] = process.argv.slice(2);
if (!(lane in names)) {
  throw new Error("Queue must be analyze, process, or scan");
}
const queue = getQueue(names[lane as keyof typeof names]);
try {
  if (action === "retry") {
    if (!jobId) {
      throw new Error("retry requires an explicit failed job ID");
    }
    const job = await queue.getJob(jobId);
    if (!job || (await job.getState()) !== "failed") {
      throw new Error("Only existing failed jobs can be replayed");
    }
    await job.retry("failed");
    console.log(JSON.stringify({ retried: job.id }));
  } else if (action === "inspect") {
    const jobs = await queue.getJobs(["failed"], 0, 49);
    console.log(
      JSON.stringify(
        {
          counts: await queue.getJobCounts(),
          failures: jobs.map((job) => ({
            attempts: job.attemptsMade,
            failedReason: job.failedReason,
            id: job.id,
            name: job.name,
          })),
        },
        null,
        2
      )
    );
  } else {
    throw new Error("Action must be inspect or retry");
  }
} finally {
  await closeQueueConnections();
  await closePrisma();
  redis.disconnect();
}
