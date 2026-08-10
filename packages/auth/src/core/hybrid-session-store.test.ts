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
  async ({ data }: { data: HybridSessionData }): Promise<Session> => ({
    ...data,
    impersonatedBy: null,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
  })
);

const mockSessionFindUnique = mock(async (): Promise<Session | null> => null);
const mockSessionFindMany = mock(async (): Promise<Session[]> => []);
const mockSessionUpdate = mock(
  async ({
    where,
    data,
  }: {
    data: Partial<HybridSessionData>;
    where: { id: string };
  }) => ({
    id: where.id,
    userId: data.userId ?? "u1",
    token: data.token ?? "token",
    expiresAt: data.expiresAt ?? new Date(Date.now() + 10_000),
    impersonatedBy: null,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
);
const mockSessionDeleteMany = mock(
  async (): Promise<{ count: number }> => ({
    count: 1,
  })
);

const mockPipelineFactory = mock((): RedisPipeline => {
  const pipeline: RedisPipeline = {
    setex: () => pipeline,
    sadd: () => pipeline,
    exec: async () => [],
    del: () => pipeline,
    srem: () => pipeline,
  };

  return pipeline;
});

const mockRedisGet = mock(async (): Promise<string | null> => null);
const mockRedisKeys = mock(async (): Promise<string[]> => []);
const mockRedisSmembers = mock(async (): Promise<string[]> => []);
const mockRedisDel = mock(async (): Promise<number> => 1);

mock.module("@asm/db", () => ({
  prisma: {
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      findMany: mockSessionFindMany,
      update: mockSessionUpdate,
      deleteMany: mockSessionDeleteMany,
    },
  },
  redis: {
    pipeline: mockPipelineFactory,
    get: mockRedisGet,
    keys: mockRedisKeys,
    smembers: mockRedisSmembers,
    del: mockRedisDel,
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
      token: "test-token",
      userId: "user1",
      expiresAt: new Date(Date.now() + 10_000),
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
      token: "test-token",
      userId: "user1",
      expiresAt: new Date(Date.now() + 10_000),
    });

    expect(session.id).toBeDefined();
    expect(mockSessionCreate).toHaveBeenCalled();
  });

  test("findByToken finds from redis", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        id: "s1",
        token: "test",
        userId: "u1",
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const result = await store.findByToken("test");
    expect(result?.id).toBe("s1");
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  test("findByToken deletes from redis if expired", async () => {
    const expired = JSON.stringify({
      id: "s1",
      token: "test",
      userId: "u1",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
      id: "s1",
      token: "test",
      userId: "u1",
      expiresAt: new Date(Date.now() + 10_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      impersonatedBy: null,
      ipAddress: null,
      userAgent: null,
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
        id: "s1",
        token: "token1",
        userId: "u1",
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    mockSessionFindMany.mockResolvedValueOnce([
      {
        id: "s2",
        token: "token2",
        userId: "u1",
        expiresAt: new Date(Date.now() + 10_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        impersonatedBy: null,
        ipAddress: null,
        userAgent: null,
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
        id: "s1",
        token: "token1",
        userId: "u1",
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const result = await store.update("s1", { ipAddress: "127.0.0.1" });
    expect(result?.ipAddress).toBe("127.0.0.1");
    expect(mockSessionUpdate).toHaveBeenCalled();
  });

  test("update fallback to postgres if not in redis", async () => {
    mockRedisKeys.mockResolvedValueOnce([]);
    mockSessionUpdate.mockResolvedValueOnce({
      id: "s1",
      token: "token1",
      userId: "u1",
      ipAddress: "127.0.0.1",
      expiresAt: new Date(Date.now() + 10_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      impersonatedBy: null,
      userAgent: null,
    });

    const result = await store.update("s1", { ipAddress: "127.0.0.1" });
    expect(result?.ipAddress).toBe("127.0.0.1");
    expect(mockSessionUpdate).toHaveBeenCalled();
  });

  test("delete clears both stores", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        id: "s1",
        token: "token1",
        userId: "u1",
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
      id: "s1",
      token: "token1",
      userId: "u1",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockRedisGet.mockResolvedValueOnce(expired);
    await store.delete("token1");

    expect(mockSessionDeleteMany).toHaveBeenCalledWith({
      where: { token: "token1" },
    });
  });
});
