import { beforeEach, describe, expect, mock, test } from "bun:test";

interface MockNotification {
  createdAt: Date;
  id: string;
  issuerId: string;
  read: boolean;
  recipientId: string;
  type: string;
}

interface MockExpression {
  field: string;
  operator: "eq" | "gte" | "in" | "lte";
  value: unknown;
}

interface MockField {
  eq: (value: unknown) => MockExpression;
  gte: (value: unknown) => MockExpression;
  in: (values: readonly unknown[]) => MockExpression;
  lte: (value: unknown) => MockExpression;
}

interface MockNotificationCollection {
  all: () => Promise<(MockNotification & { _type: string })[]>;
  deleteAndCount: () => Promise<number>;
  first: () => Promise<(MockNotification & { _type: string }) | null>;
  limit: (limit: number) => MockNotificationCollection;
  orderBy: (
    orderBy: (notification: { createdAt: { asc: () => unknown } }) => unknown
  ) => MockNotificationCollection;
  select: (...fields: string[]) => MockNotificationCollection;
  where: (
    predicate:
      | ((notification: {
          createdAt: MockField;
          id: MockField;
          issuerId: MockField;
          read: MockField;
          recipientId: MockField;
          _type: MockField;
        }) => unknown)
      | Record<string, unknown>
  ) => MockNotificationCollection;
}

const mockNotifications: MockNotification[] = [];
const decrements: { amount: number; userId: string }[] = [];
let nextDeleteCount: number | null = null;

function createField(field: string): MockField {
  return {
    eq: (value) => ({ field, operator: "eq", value }),
    gte: (value) => ({ field, operator: "gte", value }),
    in: (values) => ({ field, operator: "in", value: values }),
    lte: (value) => ({ field, operator: "lte", value }),
  };
}

function matches(row: MockNotification, expression: MockExpression): boolean {
  const field = expression.field === "_type" ? "type" : expression.field;
  const value = row[field as keyof MockNotification];
  if (expression.operator === "in") {
    return Array.isArray(expression.value) && expression.value.includes(value);
  }
  if (expression.operator === "eq") {
    return value === expression.value;
  }
  if (expression.operator === "gte") {
    return (
      value instanceof Date &&
      expression.value instanceof Date &&
      value >= expression.value
    );
  }
  return (
    value instanceof Date &&
    expression.value instanceof Date &&
    value <= expression.value
  );
}

function createMockCollection(): MockNotificationCollection {
  const filters: MockExpression[] = [];
  let limit = 100;
  const collection: MockNotificationCollection = {
    all: () => {
      const rows = mockNotifications
        .filter((row) => filters.every((filter) => matches(row, filter)))
        .toSorted(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
        )
        .slice(0, limit)
        .map((row) => ({ ...row, _type: row.type }));
      return Promise.resolve(rows);
    },
    deleteAndCount: () => {
      if (nextDeleteCount !== null) {
        const count = nextDeleteCount;
        nextDeleteCount = null;
        return Promise.resolve(count);
      }
      const selected = mockNotifications.filter((row) =>
        filters.every((filter) => matches(row, filter))
      );
      for (const row of selected) {
        const index = mockNotifications.indexOf(row);
        if (index !== -1) {
          mockNotifications.splice(index, 1);
        }
      }
      return Promise.resolve(selected.length);
    },
    first: () => collection.all().then((rows) => rows[0] ?? null),
    limit: (value) => {
      limit = value;
      return collection;
    },
    orderBy: () => collection,
    select: () => collection,
    where: (predicate) => {
      if (typeof predicate === "function") {
        const model = {
          _type: createField("_type"),
          createdAt: createField("createdAt"),
          id: createField("id"),
          issuerId: createField("issuerId"),
          read: createField("read"),
          recipientId: createField("recipientId"),
        };
        const expression = predicate(model);
        if (Array.isArray(expression)) {
          filters.push(...(expression as MockExpression[]));
        } else if (expression) {
          filters.push(expression as MockExpression);
        }
        return collection;
      }
      for (const [field, value] of Object.entries(predicate)) {
        if (field === "id" && typeof value === "string") {
          filters.push({ field, operator: "eq", value });
        }
      }
      return collection;
    },
  };
  return collection;
}

const mockPrisma = {
  transaction: <T>(
    fn: (tx: {
      orm: { public: { Notifications: MockNotificationCollection } };
    }) => Promise<T>
  ): Promise<T> =>
    fn({
      orm: { public: { Notifications: createMockCollection() } },
    }),
};

mock.module("@prisma/orm-postgres/orm-client", () => ({
  and: (...expressions: unknown[]) => expressions,
}));

mock.module("../prisma", () => ({
  default: mockPrisma,
  fromPrismaDateTime: (value: unknown) =>
    value instanceof Date ? value : new Date(String(value)),
  toPrismaDateTime: (value: Date) => value,
}));

mock.module("../../queue", () => ({
  unreadNotificationCache: {
    decrement: mock((userId: string, amount = 1) => {
      decrements.push({ amount, userId });
      return Promise.resolve(0);
    }),
  },
}));

describe("notification cleanup transactions", () => {
  const ZEPH_ID = "sys-zeph";
  const OTHER_USER_ID = "user-other";
  const USER_A = "user-a";
  const USER_B = "user-b";

  beforeEach(() => {
    mockNotifications.length = 0;
    decrements.length = 0;
    nextDeleteCount = null;
  });

  describe("cleanupExpiredPublishedNotifications", () => {
    test("deletes Zeph's PUBLISHED notifications older than 15 minutes", async () => {
      const { cleanupExpiredPublishedNotifications } =
        await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);
      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);

      mockNotifications.push(
        // Old Zeph PUBLISHED notification (should be deleted)
        {
          createdAt: twentyMinsAgo,
          id: "notif-old-pub-1",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        },
        // Old Zeph PUBLISHED notification already read (should be deleted, but no unread decrement)
        {
          createdAt: twentyMinsAgo,
          id: "notif-old-pub-2",
          issuerId: ZEPH_ID,
          read: true,
          recipientId: USER_B,
          type: "PUBLISHED",
        },
        // Recent Zeph PUBLISHED notification (MUST NOT be deleted)
        {
          createdAt: tenMinsAgo,
          id: "notif-recent-pub",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        },
        // Old Zeph MODERATION notification (MUST NOT be deleted)
        {
          createdAt: twentyMinsAgo,
          id: "notif-old-mod",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "MODERATION",
        },
        // Old Zeph TRANSCRIPTION notification (MUST NOT be deleted)
        {
          createdAt: twentyMinsAgo,
          id: "notif-old-trans",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "TRANSCRIPTION",
        },
        // Old other user LIKE/COMMENT/MENTION notification (MUST NOT be deleted)
        {
          createdAt: twentyMinsAgo,
          id: "notif-old-like",
          issuerId: OTHER_USER_ID,
          read: false,
          recipientId: USER_A,
          type: "AMPLIFY",
        }
      );

      const result = await cleanupExpiredPublishedNotifications({ now });

      expect(result.deletedCount).toBe(2);
      expect(result.batchesProcessed).toBe(1);

      // Verify the surviving notifications
      const survivingIds = mockNotifications.map((n) => n.id);
      expect(survivingIds).toContain("notif-recent-pub");
      expect(survivingIds).toContain("notif-old-mod");
      expect(survivingIds).toContain("notif-old-trans");
      expect(survivingIds).toContain("notif-old-like");
      expect(survivingIds).not.toContain("notif-old-pub-1");
      expect(survivingIds).not.toContain("notif-old-pub-2");

      // Verify unread notification counter was decremented for USER_A (had 1 unread purged)
      // and NOT for USER_B (whose purged notification was already read)
      expect(decrements).toEqual([{ amount: 1, userId: USER_A }]);
    });

    test("processes large backlogs across multiple transaction batches", async () => {
      const { cleanupExpiredPublishedNotifications } =
        await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      // Create 5 rows with batchSize = 2 (should run 3 batches: 2, 2, 1)
      for (let i = 1; i <= 5; i += 1) {
        mockNotifications.push({
          createdAt: thirtyMinsAgo,
          id: `notif-batch-${i}`,
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        });
      }

      const result = await cleanupExpiredPublishedNotifications({
        batchSize: 2,
        now,
      });

      expect(result.deletedCount).toBe(5);
      expect(result.batchesProcessed).toBe(3);
      expect(mockNotifications.length).toBe(0);
    });

    test("stops when maxBatches limit is reached", async () => {
      const { cleanupExpiredPublishedNotifications } =
        await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      for (let i = 1; i <= 10; i += 1) {
        mockNotifications.push({
          createdAt: thirtyMinsAgo,
          id: `notif-limit-${i}`,
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        });
      }

      const result = await cleanupExpiredPublishedNotifications({
        batchSize: 2,
        maxBatches: 2,
        now,
      });

      // 2 batches * 2 = 4 deleted, 6 remain
      expect(result.deletedCount).toBe(4);
      expect(result.batchesProcessed).toBe(2);
      expect(mockNotifications.length).toBe(6);
    });

    test("correctly aggregates unread count decrements across multiple distinct users", async () => {
      const { cleanupExpiredPublishedNotifications } =
        await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const USER_C = "user-c";

      // User A: 3 unread
      mockNotifications.push(
        {
          createdAt: thirtyMinsAgo,
          id: "notif-a-1",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        },
        {
          createdAt: thirtyMinsAgo,
          id: "notif-a-2",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        },
        {
          createdAt: thirtyMinsAgo,
          id: "notif-a-3",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        },
        // User B: 2 unread, 1 read
        {
          createdAt: thirtyMinsAgo,
          id: "notif-b-1",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_B,
          type: "PUBLISHED",
        },
        {
          createdAt: thirtyMinsAgo,
          id: "notif-b-2",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_B,
          type: "PUBLISHED",
        },
        {
          createdAt: thirtyMinsAgo,
          id: "notif-b-read",
          issuerId: ZEPH_ID,
          read: true,
          recipientId: USER_B,
          type: "PUBLISHED",
        },
        // User C: 2 read (no unread count decrement)
        {
          createdAt: thirtyMinsAgo,
          id: "notif-c-1",
          issuerId: ZEPH_ID,
          read: true,
          recipientId: USER_C,
          type: "PUBLISHED",
        },
        {
          createdAt: thirtyMinsAgo,
          id: "notif-c-2",
          issuerId: ZEPH_ID,
          read: true,
          recipientId: USER_C,
          type: "PUBLISHED",
        }
      );

      const result = await cleanupExpiredPublishedNotifications({
        batchSize: 10,
        now,
      });

      expect(result.deletedCount).toBe(8);
      expect(result.batchesProcessed).toBe(1);
      expect(mockNotifications.length).toBe(0);

      // Verify decrements: User A should have amount 3, User B should have amount 2, User C should have no decrement
      const userADecrement = decrements.find((d) => d.userId === USER_A);
      const userBDecrement = decrements.find((d) => d.userId === USER_B);
      const userCDecrement = decrements.find((d) => d.userId === USER_C);

      expect(userADecrement).toEqual({ amount: 3, userId: USER_A });
      expect(userBDecrement).toEqual({ amount: 2, userId: USER_B });
      expect(userCDecrement).toBeUndefined();
    });

    test("honors batchDelayMs throttler between transaction batches", async () => {
      const { cleanupExpiredPublishedNotifications } =
        await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      for (let i = 1; i <= 4; i += 1) {
        mockNotifications.push({
          createdAt: thirtyMinsAgo,
          id: `notif-delay-${i}`,
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        });
      }

      const start = Date.now();
      const result = await cleanupExpiredPublishedNotifications({
        batchDelayMs: 20,
        batchSize: 2,
        now,
      });
      const duration = Date.now() - start;

      expect(result.deletedCount).toBe(4);
      expect(result.batchesProcessed).toBe(3);
      expect(duration).toBeGreaterThanOrEqual(30);
    });

    test("honors custom ageMs parameter", async () => {
      const { cleanupExpiredPublishedNotifications } =
        await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);
      const fortyMinsAgo = new Date(now.getTime() - 40 * 60 * 1000);

      mockNotifications.push(
        {
          createdAt: fortyMinsAgo,
          id: "notif-40m",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        },
        {
          createdAt: twentyMinsAgo,
          id: "notif-20m",
          issuerId: ZEPH_ID,
          read: false,
          recipientId: USER_A,
          type: "PUBLISHED",
        }
      );

      // Requiring age >= 30 mins should delete notif-40m but keep notif-20m
      const result = await cleanupExpiredPublishedNotifications({
        ageMs: 30 * 60 * 1000,
        now,
      });

      expect(result.deletedCount).toBe(1);
      expect(mockNotifications.map((n) => n.id)).toEqual(["notif-20m"]);
    });
  });

  describe("cleanupSinglePublishedNotification", () => {
    test("deletes an eligible published notification and decrements unread cache", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      mockNotifications.push({
        createdAt: twentyMinsAgo,
        id: "notif-single-1",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deleted = await cleanupSinglePublishedNotification(
        "notif-single-1",
        { now }
      );

      expect(deleted).toBe(true);
      expect(mockNotifications.length).toBe(0);
      expect(decrements).toEqual([{ amount: 1, userId: USER_A }]);
    });

    test("deletes an eligible notification but does NOT decrement unread cache if already read", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      mockNotifications.push({
        createdAt: twentyMinsAgo,
        id: "notif-read-single",
        issuerId: ZEPH_ID,
        read: true,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deleted = await cleanupSinglePublishedNotification(
        "notif-read-single",
        { now }
      );

      expect(deleted).toBe(true);
      expect(mockNotifications.length).toBe(0);
      expect(decrements.length).toBe(0);
    });

    test("handles exact 15-minute boundary and clock-skew leeway correctly", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const exactly15MinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const withinLeeway = new Date(now.getTime() - (15 * 60 * 1000 - 3000));
      const outsideLeeway = new Date(now.getTime() - (15 * 60 * 1000 - 10_000));

      // Exactly 15 minutes ago: eligible
      mockNotifications.push({
        createdAt: exactly15MinsAgo,
        id: "notif-boundary-eligible",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deletedEligible = await cleanupSinglePublishedNotification(
        "notif-boundary-eligible",
        { now }
      );
      expect(deletedEligible).toBe(true);

      // 14 minutes 57 seconds ago (within 5s clock skew leeway): eligible
      mockNotifications.push({
        createdAt: withinLeeway,
        id: "notif-boundary-leeway",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deletedLeeway = await cleanupSinglePublishedNotification(
        "notif-boundary-leeway",
        { now }
      );
      expect(deletedLeeway).toBe(true);

      // 14 minutes 50 seconds ago (outside 5s leeway): rejected
      mockNotifications.push({
        createdAt: outsideLeeway,
        id: "notif-boundary-too-young",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deletedTooYoung = await cleanupSinglePublishedNotification(
        "notif-boundary-too-young",
        { now }
      );
      expect(deletedTooYoung).toBe(false);
      expect(mockNotifications.length).toBe(1);
    });

    test("refuses to delete if notification is too young (< 15 mins)", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);

      mockNotifications.push({
        createdAt: fiveMinsAgo,
        id: "notif-young",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deleted = await cleanupSinglePublishedNotification("notif-young", {
        now,
      });

      expect(deleted).toBe(false);
      expect(mockNotifications.length).toBe(1);
      expect(decrements.length).toBe(0);
    });

    test("refuses to delete if notification is MODERATION", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      mockNotifications.push({
        createdAt: twentyMinsAgo,
        id: "notif-mod",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "MODERATION",
      });

      const deleted = await cleanupSinglePublishedNotification("notif-mod", {
        now,
      });

      expect(deleted).toBe(false);
      expect(mockNotifications.length).toBe(1);
    });

    test("refuses to delete if notification is TRANSCRIPTION", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      mockNotifications.push({
        createdAt: twentyMinsAgo,
        id: "notif-trans",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "TRANSCRIPTION",
      });

      const deleted = await cleanupSinglePublishedNotification("notif-trans", {
        now,
      });

      expect(deleted).toBe(false);
      expect(mockNotifications.length).toBe(1);
    });

    test("refuses to delete if issuer is not Zeph", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      mockNotifications.push({
        createdAt: twentyMinsAgo,
        id: "notif-other",
        issuerId: OTHER_USER_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      const deleted = await cleanupSinglePublishedNotification("notif-other", {
        now,
      });

      expect(deleted).toBe(false);
      expect(mockNotifications.length).toBe(1);
    });

    test("returns false when notification does not exist (idempotent)", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const deleted = await cleanupSinglePublishedNotification("non-existent");
      expect(deleted).toBe(false);
    });

    test("handles concurrent deletion race condition cleanly", async () => {
      const { cleanupSinglePublishedNotification } = await import("./cleanup");

      const now = new Date("2026-09-13T12:30:00.000Z");
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      mockNotifications.push({
        createdAt: twentyMinsAgo,
        id: "notif-race",
        issuerId: ZEPH_ID,
        read: false,
        recipientId: USER_A,
        type: "PUBLISHED",
      });

      // Simulate deleteMany returning count 0 as if another worker deleted it first
      nextDeleteCount = 0;

      const deleted = await cleanupSinglePublishedNotification("notif-race", {
        now,
      });

      expect(deleted).toBe(false);
      expect(decrements.length).toBe(0);
    });
  });
});
