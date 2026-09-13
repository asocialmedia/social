import { beforeEach, describe, expect, mock, test } from "bun:test";

interface MockQueueJob {
  data: Record<string, unknown>;
  name: string;
  opts?: Record<string, unknown>;
}

const mockJobs = new Map<string, MockQueueJob[]>();
const mockSchedulers = new Map<string, Record<string, unknown>>();

class MockQueue {
  name: string;
  constructor(name: string) {
    this.name = name;
    if (!mockJobs.has(name)) {
      mockJobs.set(name, []);
    }
  }

  add(
    name: string,
    data: Record<string, unknown>,
    opts?: Record<string, unknown>
  ) {
    mockJobs.get(this.name)?.push({ data, name, opts });
    return Promise.resolve({ id: opts?.jobId ?? "job-id" });
  }

  upsertJobScheduler(schedulerId: string, options: Record<string, unknown>) {
    mockSchedulers.set(`${this.name}:${schedulerId}`, options);
    return Promise.resolve();
  }
}

mock.module("bullmq", () => ({
  Queue: MockQueue,
}));

describe("queue notification cleanup jobs and schedulers", () => {
  beforeEach(() => {
    mockJobs.clear();
    mockSchedulers.clear();
  });

  test("schedulePublishedNotificationCleanup adds delayed job to maintenance queue", async () => {
    const { schedulePublishedNotificationCleanup } = await import("./queue");

    await schedulePublishedNotificationCleanup("notif-123");

    const maintenanceJobs = mockJobs.get("maintenance") ?? [];
    expect(maintenanceJobs.length).toBe(1);
    expect(maintenanceJobs[0]).toEqual({
      data: { notificationId: "notif-123" },
      name: "cleanup-published-notification",
      opts: {
        delay: 15 * 60 * 1000,
        jobId: "cleanup-published-notif-notif-123",
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  });

  test("registerMaintenanceSchedulers registers cleanup-published-notifications", async () => {
    const { registerMaintenanceSchedulers } = await import("./queue");

    await registerMaintenanceSchedulers();

    expect(
      mockSchedulers.get("maintenance:cleanup-published-notifications")
    ).toEqual({
      every: 5 * 60 * 1000,
    });
  });
});
