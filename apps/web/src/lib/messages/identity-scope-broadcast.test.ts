import { describe, expect, test } from "bun:test";

import {
  createIdentityScopeBroadcast,
  identityScopeBroadcastChannelName,
} from "./identity-scope-broadcast";
import type {
  IdentityScopeBroadcastPort,
  IdentityScopeStoragePort,
} from "./identity-scope-broadcast";

function createChannelBus() {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  return (name: string): IdentityScopeBroadcastPort => {
    let open = true;
    const channelListeners = listeners.get(name) ?? new Set();
    listeners.set(name, channelListeners);
    return {
      addMessageListener(listener) {
        channelListeners.add(listener);
        return () => channelListeners.delete(listener);
      },
      close() {
        open = false;
      },
      postMessage(value) {
        if (open) {
          for (const listener of channelListeners) {
            listener(value);
          }
        }
      },
    };
  };
}

function createStorageBus() {
  const listeners = new Set<
    (event: { key: string | null; newValue: string | null }) => void
  >();
  return (): IdentityScopeStoragePort => ({
    addStorageListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setItem(key, value) {
      for (const listener of listeners) {
        listener({ key, newValue: value });
      }
    },
  });
}

describe("identity scope broadcast", () => {
  test("signals only the matching account and filters messages from itself", () => {
    const createChannel = createChannelBus();
    const firstNotices: unknown[] = [];
    const secondNotices: unknown[] = [];
    const otherAccountNotices: unknown[] = [];
    const first = createIdentityScopeBroadcast({
      createChannel,
      onNotice: (notice) => firstNotices.push(notice),
      sourceId: "tab-a",
      userId: "user/a",
    });
    const second = createIdentityScopeBroadcast({
      createChannel,
      onNotice: (notice) => secondNotices.push(notice),
      sourceId: "tab-b",
      userId: "user/a",
    });
    const otherAccount = createIdentityScopeBroadcast({
      createChannel,
      onNotice: (notice) => otherAccountNotices.push(notice),
      sourceId: "tab-c",
      userId: "user-b",
    });

    expect(
      first.publish({ phase: "generation-changed", recoveryGeneration: 4 })
    ).toBe(true);
    expect(firstNotices).toEqual([]);
    expect(secondNotices).toEqual([
      { phase: "generation-changed", recoveryGeneration: 4 },
    ]);
    expect(otherAccountNotices).toEqual([]);
    expect(identityScopeBroadcastChannelName("user/a")).toContain(
      encodeURIComponent("user/a")
    );

    first.close();
    second.close();
    otherAccount.close();
  });

  test("uses storage events when BroadcastChannel is unavailable", () => {
    const createStoragePort = createStorageBus();
    const notices: unknown[] = [];
    const receiver = createIdentityScopeBroadcast({
      createChannel: () => null,
      createStoragePort,
      onNotice: (notice) => notices.push(notice),
      sourceId: "receiver",
      userId: "user",
    });
    const sender = createIdentityScopeBroadcast({
      createChannel: () => null,
      createStoragePort,
      onNotice: () => {},
      sourceId: "sender",
      userId: "user",
    });

    expect(
      sender.publish({ phase: "identity-ready", recoveryGeneration: 9 })
    ).toBe(true);
    expect(notices).toEqual([
      { phase: "identity-ready", recoveryGeneration: 9 },
    ]);
    expect(
      sender.publish({ phase: "generation-changed", recoveryGeneration: -1 })
    ).toBe(false);

    sender.close();
    receiver.close();
  });

  test("deduplicates a signal delivered through both cross-tab transports", () => {
    const createChannel = createChannelBus();
    const createStoragePort = createStorageBus();
    const notices: unknown[] = [];
    const receiver = createIdentityScopeBroadcast({
      createChannel,
      createStoragePort,
      onNotice: (notice) => notices.push(notice),
      sourceId: "receiver",
      userId: "user",
    });
    const sender = createIdentityScopeBroadcast({
      createChannel,
      createStoragePort,
      onNotice: () => {},
      sourceId: "sender",
      userId: "user",
    });

    sender.publish({ phase: "generation-changed", recoveryGeneration: 3 });
    expect(notices).toEqual([
      { phase: "generation-changed", recoveryGeneration: 3 },
    ]);

    sender.close();
    receiver.close();
  });

  test("closes listeners and ignores malformed storage notices", () => {
    const createStoragePort = createStorageBus();
    const notices: unknown[] = [];
    const sync = createIdentityScopeBroadcast({
      createChannel: () => null,
      createStoragePort,
      onNotice: (notice) => notices.push(notice),
      sourceId: "tab",
      userId: "user",
    });
    const storage = createStoragePort();
    storage.setItem(
      identityScopeBroadcastChannelName("user"),
      JSON.stringify({ type: "identity-scope", userId: "user" })
    );
    sync.close();
    expect(notices).toEqual([]);
    expect(
      sync.publish({ phase: "identity-ready", recoveryGeneration: 2 })
    ).toBe(false);
  });
});
