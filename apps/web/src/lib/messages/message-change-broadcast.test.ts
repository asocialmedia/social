import { describe, expect, test } from "bun:test";

import {
  createMessageChangeBroadcast,
  messageChangeBroadcastChannelName,
} from "./message-change-broadcast";
import type { MessageChangeBroadcastPort } from "./message-change-broadcast";

class TestBroadcastChannel implements MessageChangeBroadcastPort {
  readonly sent: unknown[] = [];
  readonly listeners = new Set<(value: unknown) => void>();
  closed = false;
  readonly name: string;
  private readonly channels: Map<string, Set<TestBroadcastChannel>>;

  constructor(name: string, channels: Map<string, Set<TestBroadcastChannel>>) {
    this.name = name;
    this.channels = channels;
  }

  addMessageListener(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.channels.get(this.name)?.delete(this);
  }

  postMessage(value: unknown): void {
    this.sent.push(value);
    for (const channel of this.channels.get(this.name) ?? []) {
      if (channel !== this) {
        for (const listener of channel.listeners) {
          listener(value);
        }
      }
    }
  }
}

describe("account-scoped DM change broadcasts", () => {
  test("shares only bounded invalidation metadata with tabs on the same account", () => {
    const channels = new Map<string, Set<TestBroadcastChannel>>();
    const createChannel = (name: string) => {
      const channel = new TestBroadcastChannel(name, channels);
      const group = channels.get(name) ?? new Set<TestBroadcastChannel>();
      group.add(channel);
      channels.set(name, group);
      return channel;
    };
    const sameAccountNotices: unknown[] = [];
    const otherAccountNotices: unknown[] = [];
    const sameAccount = createMessageChangeBroadcast({
      createChannel,
      onNotice: (notice) => sameAccountNotices.push(notice),
      sourceId: "same-account-tab-2",
      userId: "user/a",
    });
    const otherAccount = createMessageChangeBroadcast({
      createChannel,
      onNotice: (notice) => otherAccountNotices.push(notice),
      sourceId: "other-account-tab",
      userId: "other-user",
    });
    const senderChannel = createChannel(
      messageChangeBroadcastChannelName("user/a")
    );
    const sender = createMessageChangeBroadcast({
      createChannel: () => senderChannel,
      onNotice: () => {},
      sourceId: "same-account-tab-1",
      userId: "user/a",
    });

    expect(
      sender.publish({
        accessChanged: false,
        conversationId: "conversation-1",
        messageIds: ["message-1", "message-1", "message-2"],
        resetRequired: false,
        unavailableMessageIds: ["message-2"],
      })
    ).toBe(true);
    expect(sameAccountNotices).toEqual([
      {
        accessChanged: false,
        conversationId: "conversation-1",
        messageIds: ["message-1", "message-2"],
        resetRequired: false,
        unavailableMessageIds: ["message-2"],
      },
    ]);
    expect(otherAccountNotices).toEqual([]);
    expect(JSON.stringify(senderChannel.sent[0])).not.toContain("payload");
    expect(JSON.stringify(senderChannel.sent[0])).not.toContain("query");

    sender.close();
    sameAccount.close();
    otherAccount.close();
  });

  test("turns oversized or malformed invalidations into a full-conversation reset", () => {
    const channels = new Map<string, Set<TestBroadcastChannel>>();
    const createChannel = (name: string) => {
      const channel = new TestBroadcastChannel(name, channels);
      const group = channels.get(name) ?? new Set<TestBroadcastChannel>();
      group.add(channel);
      channels.set(name, group);
      return channel;
    };
    const received: unknown[] = [];
    const receiver = createMessageChangeBroadcast({
      createChannel,
      onNotice: (notice) => received.push(notice),
      sourceId: "receiver",
      userId: "user-1",
    });
    const senderChannel = createChannel(
      messageChangeBroadcastChannelName("user-1")
    );
    const sender = createMessageChangeBroadcast({
      createChannel: () => senderChannel,
      onNotice: () => {},
      sourceId: "sender",
      userId: "user-1",
    });

    sender.publish({
      accessChanged: false,
      conversationId: "conversation-1",
      messageIds: ["message-1", ""],
      resetRequired: false,
      unavailableMessageIds: [],
    });
    expect(received).toEqual([
      {
        accessChanged: false,
        conversationId: "conversation-1",
        messageIds: [],
        resetRequired: true,
        unavailableMessageIds: [],
      },
    ]);

    sender.close();
    receiver.close();
  });

  test("forces cache resets for permission changes", () => {
    const channels = new Map<string, Set<TestBroadcastChannel>>();
    const createChannel = (name: string) => {
      const channel = new TestBroadcastChannel(name, channels);
      const group = channels.get(name) ?? new Set<TestBroadcastChannel>();
      group.add(channel);
      channels.set(name, group);
      return channel;
    };
    const received: unknown[] = [];
    const receiver = createMessageChangeBroadcast({
      createChannel,
      onNotice: (notice) => received.push(notice),
      sourceId: "receiver",
      userId: "user-1",
    });
    const senderChannel = createChannel(
      messageChangeBroadcastChannelName("user-1")
    );
    const sender = createMessageChangeBroadcast({
      createChannel: () => senderChannel,
      onNotice: () => {},
      sourceId: "sender",
      userId: "user-1",
    });

    sender.publish({
      accessChanged: true,
      conversationId: "conversation-1",
      messageIds: ["message-1"],
      resetRequired: false,
      unavailableMessageIds: [],
    });

    expect(senderChannel.sent).toEqual([
      {
        accessChanged: true,
        conversationId: "conversation-1",
        messageIds: [],
        resetRequired: true,
        sourceId: "sender",
        type: "message-change",
        unavailableMessageIds: [],
        userId: "user-1",
        version: 1,
      },
    ]);
    expect(received).toEqual([
      {
        accessChanged: true,
        conversationId: "conversation-1",
        messageIds: [],
        resetRequired: true,
        unavailableMessageIds: [],
      },
    ]);

    sender.close();
    receiver.close();
  });

  test("returns a safe no-op when the browser channel is unavailable", () => {
    const broadcast = createMessageChangeBroadcast({
      createChannel: () => null,
      onNotice: () => {},
      sourceId: "no-channel",
      userId: "user-1",
    });
    expect(
      broadcast.publish({
        accessChanged: false,
        conversationId: "conversation-1",
        messageIds: [],
        resetRequired: true,
        unavailableMessageIds: [],
      })
    ).toBe(false);
    expect(() => broadcast.close()).not.toThrow();
  });
});
