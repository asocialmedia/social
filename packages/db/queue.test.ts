import { beforeEach, describe, expect, mock, test } from "bun:test";

const evalResults: unknown[] = [];
const incrbyArgs: string[] = [];
const getValue = mock(() => "5");
const delKeys: string[] = [];

const mockRedis = {
  del: mock((key: string) => {
    delKeys.push(key);
    return 1;
  }),
  eval: mock(
    (_script: string, _numkeys: number, _key: string, _amount: number) => {
      evalResults.push(1);
      return 1;
    }
  ),
  get: getValue,
  incrby: mock((key: string, amount: number) => {
    incrbyArgs.push(key);
    return amount;
  }),
};

mock.module("./src/redis", () => ({
  redis: mockRedis,
}));

beforeEach(() => {
  incrbyArgs.length = 0;
  delKeys.length = 0;
  evalResults.length = 0;
  mockRedis.incrby.mockClear();
  mockRedis.eval.mockClear();
  getValue.mockClear();
  mockRedis.del.mockClear();
});

describe("unreadNotificationCache", () => {
  test("increment calls incrby with the prefixed key", async () => {
    const { unreadNotificationCache } = await import("./queue");

    await unreadNotificationCache.increment("user-1", 3);

    expect(mockRedis.incrby).toHaveBeenCalledWith("unread:notif:user-1", 3);
  });

  test("decrement uses the clamp-to-zero Lua script", async () => {
    const { unreadNotificationCache } = await import("./queue");

    const result = await unreadNotificationCache.decrement("user-1");

    expect(result).toBe(1);
    const [evalCall] = mockRedis.eval.mock.calls;
    expect(evalCall).toBeDefined();
    const script = String(evalCall?.[0]);
    expect(script).toContain("math.max");
    expect(evalCall?.[1]).toBe(1);
    expect(evalCall?.[2]).toBe("unread:notif:user-1");
  });

  test("get parses the cached integer", async () => {
    const { unreadNotificationCache } = await import("./queue");

    const result = await unreadNotificationCache.get("user-1");

    expect(result).toBe(5);
    expect(getValue).toHaveBeenCalledWith("unread:notif:user-1");
  });

  test("reset deletes the key", async () => {
    const { unreadNotificationCache } = await import("./queue");

    await unreadNotificationCache.reset("user-1");

    expect(delKeys).toEqual(["unread:notif:user-1"]);
  });
});

describe("unreadMessageCache", () => {
  test("increment calls incrby with the message prefix", async () => {
    const { unreadMessageCache } = await import("./queue");

    await unreadMessageCache.increment("user-1", 2);

    expect(mockRedis.incrby).toHaveBeenCalledWith("unread:messages:user-1", 2);
  });

  test("decrement uses the clamp-to-zero Lua script", async () => {
    const { unreadMessageCache } = await import("./queue");

    const result = await unreadMessageCache.decrement("user-1");

    expect(result).toBe(1);
    const [evalCall] = mockRedis.eval.mock.calls;
    expect(evalCall).toBeDefined();
    const script = String(evalCall?.[0]);
    expect(script).toContain("math.max");
    expect(evalCall?.[1]).toBe(1);
    expect(evalCall?.[2]).toBe("unread:messages:user-1");
  });

  test("get parses the cached integer", async () => {
    const { unreadMessageCache } = await import("./queue");

    const result = await unreadMessageCache.get("user-1");

    expect(result).toBe(5);
    expect(getValue).toHaveBeenCalledWith("unread:messages:user-1");
  });

  test("reset deletes the key", async () => {
    const { unreadMessageCache } = await import("./queue");

    await unreadMessageCache.reset("user-1");

    expect(delKeys).toEqual(["unread:messages:user-1"]);
  });
});
