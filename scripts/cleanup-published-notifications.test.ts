import { describe, expect, mock, test } from "bun:test";

import { NotificationType } from "@asm/db";

import {
  parseCleanupArgs,
  parseNumberFlag,
  runCleanupCli,
} from "./cleanup-published-notifications";

describe("cleanup-published-notifications script", () => {
  test("parseNumberFlag extracts valid numbers and falls back to default", () => {
    expect(parseNumberFlag(["--batch-size=50"], "--batch-size=", 100)).toBe(50);
    expect(
      parseNumberFlag(
        ["--other-flag", "--batch-size=200"],
        "--batch-size=",
        100
      )
    ).toBe(200);
    expect(
      parseNumberFlag(["--batch-size=invalid"], "--batch-size=", 100)
    ).toBe(100);
    expect(parseNumberFlag(["--batch-size=-10"], "--batch-size=", 100)).toBe(
      100
    );
    expect(parseNumberFlag([], "--batch-size=", 100)).toBe(100);
  });

  test("parseCleanupArgs parses default parameters", () => {
    const options = parseCleanupArgs([]);

    expect(options.isDryRun).toBe(false);
    expect(options.batchSize).toBe(100);
    expect(options.maxBatches).toBe(1000);
    expect(options.batchDelayMs).toBe(20);
    expect(options.ageMinutes).toBe(15);
    expect(options.ageMs).toBe(15 * 60 * 1000);
  });

  test("parseCleanupArgs parses custom arguments and dry-run flag", () => {
    const options = parseCleanupArgs([
      "--dry-run",
      "--batch-size=250",
      "--max-batches=10",
      "--delay-ms=50",
      "--age-minutes=30",
    ]);

    expect(options.isDryRun).toBe(true);
    expect(options.batchSize).toBe(250);
    expect(options.maxBatches).toBe(10);
    expect(options.batchDelayMs).toBe(50);
    expect(options.ageMinutes).toBe(30);
    expect(options.ageMs).toBe(30 * 60 * 1000);
  });

  test("runCleanupCli in dry-run mode counts eligible notifications without deleting", async () => {
    const logs: string[] = [];
    let recordedArgs:
      | {
          where: {
            createdAt: { lte: Date };
            issuerId: string;
            type: NotificationType;
          };
        }
      | undefined;
    const mockCount = mock(
      (args: {
        where: {
          createdAt: { lte: Date };
          issuerId: string;
          type: NotificationType;
        };
      }) => {
        recordedArgs = args;
        return Promise.resolve(42);
      }
    );
    const mockCleanup = mock(() =>
      Promise.resolve({ batchesProcessed: 0, deletedCount: 0 })
    );

    const result = await runCleanupCli(["--dry-run"], {
      cleanupFn: mockCleanup,
      countFn: mockCount,
      logger: { log: (msg: string) => logs.push(msg) },
    });

    expect(result.dryRun).toBe(true);
    expect(result.count).toBe(42);
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockCleanup).toHaveBeenCalledTimes(0);

    // Verify filter parameters passed to count
    expect(recordedArgs?.where.issuerId).toBe("sys-zeph");
    expect(recordedArgs?.where.type).toBe(NotificationType.PUBLISHED);
    expect(recordedArgs?.where.createdAt.lte).toBeInstanceOf(Date);

    expect(logs.some((l) => l.includes("Found 42 eligible"))).toBe(true);
  });

  test("runCleanupCli in live mode invokes cleanup function with configured options", async () => {
    const logs: string[] = [];
    const mockCount = mock(() => Promise.resolve(0));
    const mockCleanup = mock(() =>
      Promise.resolve({ batchesProcessed: 5, deletedCount: 450 })
    );

    const result = await runCleanupCli(
      [
        "--batch-size=100",
        "--delay-ms=10",
        "--max-batches=20",
        "--age-minutes=20",
      ],
      {
        cleanupFn: mockCleanup,
        countFn: mockCount,
        logger: { log: (msg: string) => logs.push(msg) },
      }
    );

    expect(result.dryRun).toBe(false);
    expect(result.result).toEqual({ batchesProcessed: 5, deletedCount: 450 });
    expect(mockCount).toHaveBeenCalledTimes(0);
    expect(mockCleanup).toHaveBeenCalledWith({
      ageMs: 20 * 60 * 1000,
      batchDelayMs: 10,
      batchSize: 100,
      maxBatches: 20,
    });

    expect(
      logs.some((l) => l.includes("Deleted:           450 notifications"))
    ).toBe(true);
  });
});
