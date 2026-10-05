// Runs the suite in sequential batches instead of one `bun test --parallel` over
// every file at once.
//
// `scripts/testing/run-tests.ts` hands its whole file list to a single bun invocation
// with `--parallel`, which spawns a worker per file group; on this machine that runs
// the machine out of memory before it finishes. This asks the same discovery module
// for the same list and then walks it in batches, so peak memory is one batch's worth.
//
// Usage: bun scripts/testing/run-sharded-tests.ts [batchSize]

import { collectTestFiles } from "./test-file-discovery";

const BATCH_SIZE = Number(Bun.argv[2] ?? 150);

const files = await collectTestFiles("all", process.cwd());
console.log(`Discovered ${files.length} test files. Batch size ${BATCH_SIZE}.`);

let failedBatches = 0;
let passedFiles = 0;
let failedFiles = 0;

for (let start = 0; start < files.length; start += BATCH_SIZE) {
  const batch = files.slice(start, start + BATCH_SIZE);
  const label = `${start + 1}-${start + batch.length}`;
  process.stdout.write(`\n=== batch ${label} of ${files.length} ===\n`);

  const proc = Bun.spawn({
    cmd: [
      "bun",
      "test",
      "--parallel",
      "--env-file=.env.test",
      ...batch.map((filePath) => `./${filePath}`),
    ],
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test" },
    stderr: "inherit",
    stdout: "inherit",
  });

  const code = await proc.exited;

  if (code !== 0) {
    failedBatches += 1;
    console.error(`Batch ${label} exited ${code}.`);
  }
}

console.log(
  `\nDone. ${failedBatches === 0 ? "All batches passed." : `${failedBatches} batch(es) failed.`}`
);
process.exit(failedBatches === 0 ? 0 : 1);
