import { describe, expect, mock, test } from "bun:test";

// In-memory fake of the redis surface used by the presence helpers: per-user
// keys (source of truth) and the online/seen index sets.
const keys = new Map<string, string>();
const onlineSet = new Set<string>();
const seenSet = new Set<string>();

function resetFake() {
  keys.clear();
  onlineSet.clear();
  seenSet.clear();
}

function pipelineRunner() {
  const ops: (() => [Error | null, unknown])[] = [];
  const p = {
    exec: () => Promise.all(ops.map((op) => op())),
    get: (key: string) => {
      ops.push(() => [null, keys.get(key) ?? null]);
      return p;
    },
    sadd: (set: string, id: string) => {
      ops.push(() => {
        if (set === "presence:online") {
          onlineSet.add(id);
        } else {
          seenSet.add(id);
        }
        return [null, 1];
      });
      return p;
    },
    setex: (key: string, _ttl: number, value: string) => {
      ops.push(() => {
        keys.set(key, value);
        return [null, "OK"];
      });
      return p;
    },
    srem: (set: string, ...ids: string[]) => {
      ops.push(() => {
        if (set === "presence:online") {
          for (const id of ids) {
            onlineSet.delete(id);
          }
        } else {
          for (const id of ids) {
            seenSet.delete(id);
          }
        }
        return [null, ids.length];
      });
      return p;
    },
  };
  return p;
}

class FakeIoRedis {
  status = "ready";
  connect = mock(() => this);
  on = mock((_event: string, _listener: () => void) => this);
  quit = mock(() => "OK");
  duplicate = mock(() => this);

  get = mock((key: string) => keys.get(key) ?? null);
  pipeline = mock(() => pipelineRunner());
  sadd = mock((set: string, id: string) => {
    if (set === "presence:online") {
      onlineSet.add(id);
    } else {
      seenSet.add(id);
    }
    return 1;
  });
  setex = mock((key: string, _ttl: number, value: string) => {
    keys.set(key, value);
    return "OK";
  });
  srem = mock((set: string, ...ids: string[]) => {
    if (set === "presence:online") {
      for (const id of ids) {
        onlineSet.delete(id);
      }
    } else {
      for (const id of ids) {
        seenSet.delete(id);
      }
    }
    return ids.length;
  });
  smembers = mock((set: string) =>
    set === "presence:online" ? [...onlineSet] : [...seenSet]
  );
}

mock.module("ioredis", () => ({
  default: FakeIoRedis,
}));

const {
  PRESENCE_ONLINE_SET,
  PRESENCE_PREFIX,
  PRESENCE_SEEN_PREFIX,
  PRESENCE_SEEN_SET,
  getIdleUsers,
  getOnlineUsers,
  markUserOnline,
} = await import("@asm/db");

describe("presence", () => {
  test("markUserOnline stamps both keys and both index sets", async () => {
    resetFake();
    await markUserOnline("u1");

    expect(keys.has(`${PRESENCE_PREFIX}u1`)).toBe(true);
    expect(keys.has(`${PRESENCE_SEEN_PREFIX}u1`)).toBe(true);
    expect(onlineSet.has("u1")).toBe(true);
    expect(seenSet.has("u1")).toBe(true);
  });

  test("getOnlineUsers returns only members with a live key and prunes stale ones", async () => {
    resetFake();
    // u1 heartbeated recently; u2 is a stale member left in the set after its
    // per-user key expired.
    keys.set(`${PRESENCE_PREFIX}u1`, String(Date.now()));
    onlineSet.add("u1");
    onlineSet.add("u2");

    const online = await getOnlineUsers();
    expect(online).toEqual(["u1"]);
    expect(onlineSet.has("u2")).toBe(false);
    expect(onlineSet.has("u1")).toBe(true);
  });

  test("getIdleUsers returns seen-but-not-online and excludes online users", async () => {
    resetFake();
    keys.set(`${PRESENCE_PREFIX}u1`, String(Date.now()));
    onlineSet.add("u1");
    keys.set(`${PRESENCE_SEEN_PREFIX}u2`, String(Date.now()));
    seenSet.add("u1");
    seenSet.add("u2");
    seenSet.add("u3"); // stale seen member, key missing

    const idle = await getIdleUsers();
    expect(idle).toEqual(["u2"]);
    expect(seenSet.has("u3")).toBe(false);
    expect(PRESENCE_ONLINE_SET).toBe("presence:online");
    expect(PRESENCE_SEEN_SET).toBe("presence:seen");
  });
});
