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

  getJob = (_jobId: string) => {
    void this.name;
    return Promise.resolve(null);
  };

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

  test("enqueueNotificationCreated uses the isolated retrying queue", async () => {
    const { enqueueNotificationCreated } = await import("./queue");

    await enqueueNotificationCreated("user-1", "notif-123");

    const notificationJobs = mockJobs.get("notifications") ?? [];
    expect(notificationJobs).toEqual([
      {
        data: { notificationId: "notif-123", recipientId: "user-1" },
        name: "notification-created",
        opts: {
          attempts: 5,
          backoff: { delay: 1000, type: "exponential" },
          jobId: "notification-created-notif-123",
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      },
    ]);
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

  test("message search jobs use stable BullMQ job IDs", async () => {
    const {
      enqueueMessageSearchBackfill,
      enqueueMessageSearchCount,
      enqueueMessageSearchOutbox,
    } = await import("./queue");

    await enqueueMessageSearchOutbox("outbox-1");
    await enqueueMessageSearchOutbox("outbox-1");
    await enqueueMessageSearchBackfill("conversation-1", "message-1");
    await enqueueMessageSearchCount("request-1");

    expect(mockJobs.get("message-search-live")).toEqual([
      expect.objectContaining({
        data: { outboxId: "outbox-1" },
        name: "index-message-outbox",
        opts: expect.objectContaining({ jobId: "dm-search-outbox-1" }),
      }),
      expect.objectContaining({
        data: { outboxId: "outbox-1" },
        name: "index-message-outbox",
        opts: expect.objectContaining({ jobId: "dm-search-outbox-1" }),
      }),
    ]);
    expect(mockJobs.get("message-search-backfill")).toEqual([
      expect.objectContaining({
        data: { conversationId: "conversation-1" },
        name: "index-conversation-search-backfill",
        opts: expect.objectContaining({
          jobId: "dm-search-backfill-conversation-1-message-1",
        }),
      }),
    ]);
    expect(mockJobs.get("message-search-count")).toEqual([
      expect.objectContaining({
        data: { requestId: "request-1" },
        name: "count-conversation-search",
        opts: expect.objectContaining({ jobId: "dm-search-count-request-1" }),
      }),
    ]);
  });
});
