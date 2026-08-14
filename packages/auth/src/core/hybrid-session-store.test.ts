import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

import type { Session } from "@asm/db";

import { HybridSessionStore } from "./hybrid-session-store";

interface HybridSessionData {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  ipAddress?: string | null;
  token: string;
  updatedAt: Date;
  userAgent?: string | null;
  userId: string;
}

interface RedisPipeline {
  del: (key: string) => RedisPipeline;
  exec: () => Promise<unknown[]>;
  sadd: (key: string, token: string) => RedisPipeline;
  setex: (key: string, ttl: number, value: string) => RedisPipeline;
  srem: (key: string, token: string) => RedisPipeline;
}

const mockSessionCreate = mock(
  ({ data }: { data: HybridSessionData }): Promise<Session> =>
    Promise.resolve({
      ...data,
      impersonatedBy: null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    })
);

const mockSessionFindUnique = mock((): Promise<Session | null> =>
  Promise.resolve(null)
);
const mockSessionFindMany = mock((): Promise<Session[]> => Promise.resolve([]));
const mockSessionUpdate = mock(
  ({
    where,
    data,
  }: {
    data: Partial<HybridSessionData>;
    where: { id: string };
  }): Promise<Session> =>
    Promise.resolve({
      createdAt: new Date(),
      expiresAt: data.expiresAt ?? new Date(Date.now() + 10_000),
      id: where.id,
      impersonatedBy: null,
      ipAddress: data.ipAddress ?? null,
      token: data.token ?? "token",
      updatedAt: new Date(),
      userAgent: data.userAgent ?? null,
      userId: data.userId ?? "u1",
    })
);
const mockSessionDeleteMany = mock(
  (_args: unknown): Promise<{ count: number }> => Promise.resolve({ count: 1 })
);

const mockPipelineFactory = mock((): RedisPipeline => {
  const pipeline: RedisPipeline = {
    del: () => pipeline,
    exec: () => Promise.resolve([]),
    sadd: () => pipeline,
    setex: () => pipeline,
    srem: () => pipeline,
  };

  return pipeline;
});

const mockRedisGet = mock((): Promise<string | null> => Promise.resolve(null));
const mockRedisKeys = mock((): Promise<string[]> => Promise.resolve([]));
const mockRedisSmembers = mock((): Promise<string[]> => Promise.resolve([]));
const mockRedisDel = mock((): Promise<number> => Promise.resolve(1));

mock.module("@asm/db", () => ({
  prisma: {
    session: {
      create: mockSessionCreate,
      deleteMany: mockSessionDeleteMany,
      findMany: mockSessionFindMany,
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate,
    },
  },
  redis: {
    del: mockRedisDel,
    get: mockRedisGet,
    keys: mockRedisKeys,
    pipeline: mockPipelineFactory,
    smembers: mockRedisSmembers,
  },
}));

describe("HybridSessionStore", () => {
  let store: HybridSessionStore;

  beforeEach(() => {
    mockSessionCreate.mockClear();
    mockSessionFindUnique.mockClear();
    mockSessionFindMany.mockClear();
    mockSessionUpdate.mockClear();
    mockSessionDeleteMany.mockClear();

    mockPipelineFactory.mockClear();
    mockRedisGet.mockClear();
    mockRedisKeys.mockClear();
    mockRedisSmembers.mockClear();
    mockRedisDel.mockClear();

    store = new HybridSessionStore();
  });

  afterEach(() => {
    store.destroy();
  });

  afterAll(() => {
    mock.restore();
  });

  test("create stores in redis and postgres", async () => {
    const session = await store.create({
      expiresAt: new Date(Date.now() + 10_000),
      token: "test-token",
      userId: "user1",
    });

    expect(session.id).toBeDefined();
    expect(mockPipelineFactory).toHaveBeenCalled();
    expect(mockSessionCreate).toHaveBeenCalled();
  });

  test("create fallback to postgres if redis fails", async () => {
    mockPipelineFactory.mockImplementationOnce(() => {
      throw new Error("Redis fail");
    });

    const session = await store.create({
      expiresAt: new Date(Date.now() + 10_000),
      token: "test-token",
      userId: "user1",
    });

    expect(session.id).toBeDefined();
    expect(mockSessionCreate).toHaveBeenCalled();
  });

  test("findByToken finds from redis", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        id: "s1",
        token: "test",
        updatedAt: new Date().toISOString(),
        userId: "u1",
      })
    );

    const result = await store.findByToken("test");
    expect(result?.id).toBe("s1");
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  test("findByToken deletes from redis if expired", async () => {
    const expired = JSON.stringify({
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      id: "s1",
      token: "test",
      updatedAt: new Date().toISOString(),
      userId: "u1",
    });

    mockRedisGet.mockResolvedValueOnce(expired);
    mockRedisGet.mockResolvedValueOnce(expired);

    const result = await store.findByToken("test");
    expect(result).toBeNull();
    expect(mockPipelineFactory).toHaveBeenCalled();
  });

  test("findByToken fallback to postgres if not in redis", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockSessionFindUnique.mockResolvedValueOnce({
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10_000),
      id: "s1",
      impersonatedBy: null,
      ipAddress: null,
      token: "test",
      updatedAt: new Date(),
      userAgent: null,
      userId: "u1",
    });

    const result = await store.findByToken("test");
    expect(result?.id).toBe("s1");
    expect(mockSessionFindUnique).toHaveBeenCalled();
    expect(mockPipelineFactory).toHaveBeenCalled();
  });

  test("findByUserId gets from redis and postgres", async () => {
    mockRedisSmembers.mockResolvedValueOnce(["token1"]);
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        id: "s1",
        token: "token1",
        updatedAt: new Date().toISOString(),
        userId: "u1",
      })
    );

    mockSessionFindMany.mockResolvedValueOnce([
      {
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10_000),
        id: "s2",
        impersonatedBy: null,
        ipAddress: null,
        token: "token2",
        updatedAt: new Date(),
        userAgent: null,
        userId: "u1",
      },
    ]);

    const results = await store.findByUserId("u1");
    expect(results.length).toBe(2);
    expect(results.map((entry) => entry.id)).toEqual(["s1", "s2"]);
  });

  test("update stores in redis and postgres", async () => {
    mockRedisKeys.mockResolvedValueOnce(["session:active:token1"]);
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        id: "s1",
        token: "token1",
        updatedAt: new Date().toISOString(),
        userId: "u1",
      })
    );

    const result = await store.update("s1", { ipAddress: "127.0.0.1" });
    expect(result?.ipAddress).toBe("127.0.0.1");
    expect(mockSessionUpdate).toHaveBeenCalled();
  });

  test("update fallback to postgres if not in redis", async () => {
    mockRedisKeys.mockResolvedValueOnce([]);
    mockSessionUpdate.mockResolvedValueOnce({
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10_000),
      id: "s1",
      impersonatedBy: null,
      ipAddress: "127.0.0.1",
      token: "token1",
      updatedAt: new Date(),
      userAgent: null,
      userId: "u1",
    });

    const result = await store.update("s1", { ipAddress: "127.0.0.1" });
    expect(result?.ipAddress).toBe("127.0.0.1");
    expect(mockSessionUpdate).toHaveBeenCalled();
  });

  test("delete clears both stores", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        id: "s1",
        token: "token1",
        updatedAt: new Date().toISOString(),
        userId: "u1",
      })
    );

    await store.delete("token1");
    expect(mockPipelineFactory).toHaveBeenCalled();
    expect(mockSessionDeleteMany).toHaveBeenCalled();
  });

  test("deleteByUserId clears both stores", async () => {
    mockRedisSmembers.mockResolvedValueOnce(["token1"]);

    await store.deleteByUserId("u1");
    expect(mockPipelineFactory).toHaveBeenCalled();
    expect(mockSessionDeleteMany).toHaveBeenCalled();
  });

  test("sync of expired sessions occurs through public API", async () => {
    const expired = JSON.stringify({
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      id: "s1",
      token: "token1",
      updatedAt: new Date().toISOString(),
      userId: "u1",
    });

    mockRedisGet.mockResolvedValueOnce(expired);
    await store.delete("token1");

    expect(mockSessionDeleteMany).toHaveBeenCalledWith({
      where: { token: "token1" },
    });
  });
});
