import { describe, expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import {
  MessageOutbox,
  mergeOutgoingMessages,
  getMessageOutbox,
  clearOutboxesOutsideScope,
} from "./outbox";
import type { MessageData } from "./types";

const payload: MessagePayload = { content: "hello", type: "text" };
function message(id = "local", createdAt = new Date(100)): MessageData {
  return {
    ciphertext: "",
    conversationId: "conversation",
    createdAt,
    deletedAt: null,
    editedAt: null,
    id,
    iv: "",
    ratchetIndex: 0,
    senderId: "me",
  };
}

describe("local message outbox", () => {
  test("renders immediately without changing ciphertext history and dedupes the SSE echo", () => {
    const outbox = new MessageOutbox("me:1");
    const history = [message("older", new Date(0))];
    outbox.start(message(), payload);
    const rendered = mergeOutgoingMessages(history, outbox.getSnapshot());
    expect(rendered.map((entry) => entry.id)).toEqual(["older", "local"]);
    expect(history.map((entry) => entry.id)).toEqual(["older"]);
    const sent = { ...message(), ciphertext: "accepted" };
    outbox.acknowledge(sent);
    expect(
      mergeOutgoingMessages([...history, sent], outbox.getSnapshot()).map(
        (entry) => entry.id
      )
    ).toEqual(["older", "local"]);
    expect(outbox.get("local")?.payload).toBe(payload);
  });

  test("keeps a stable ID and payload when retrying a failed send", () => {
    const outbox = new MessageOutbox("me:1");
    outbox.start(message(), payload);
    expect(outbox.fail("local")).toBe(true);
    const retried: string[] = [];
    outbox.setRetryHandler((entry) => {
      retried.push(entry.message.id);
      outbox.start(entry.message, entry.payload);
      return Promise.resolve();
    });
    outbox.retry("local");
    outbox.retry("local");
    expect(retried).toEqual(["local"]);
    expect(outbox.get("local")?.status).toBe("sending");
    expect(outbox.get("local")?.payload).toBe(payload);
  });

  test("an acknowledged SSE write cannot become failed if its HTTP response is lost", () => {
    const outbox = new MessageOutbox("me:1");
    outbox.start(message(), payload);
    outbox.acknowledge(message());
    expect(outbox.fail("local")).toBe(false);
    outbox.retire(new Set(["local"]));
    expect(outbox.getSnapshot()).toHaveLength(0);
    expect(outbox.wasAcknowledged("local")).toBe(true);
  });

  test("rejects a mismatched conversation or author and isolates identity scopes", () => {
    const outbox = new MessageOutbox("me:1");
    outbox.start(message(), payload);
    expect(
      outbox.acknowledge({ ...message(), senderId: "someone-else" })
    ).toBeUndefined();
    expect(
      outbox.acknowledge({ ...message(), conversationId: "another" })
    ).toBeUndefined();
    expect(outbox.get("local")?.status).toBe("sending");
    expect(new MessageOutbox("me:2").getSnapshot()).toHaveLength(0);
  });

  test("bounds failed-message retention and keeps a cached immutable snapshot", () => {
    const outbox = new MessageOutbox("me:1");
    for (let index = 0; index < 32; index += 1) {
      outbox.start(message(String(index)), payload);
      outbox.fail(String(index));
    }
    const snapshot = outbox.getSnapshot();
    expect(outbox.getSnapshot()).toBe(snapshot);
    expect(() => outbox.start(message("overflow"), payload)).toThrow("unsent");
    expect(outbox.getSnapshot()).toHaveLength(32);
    expect(MessageOutbox.getServerSnapshot()).toHaveLength(0);
  });

  test("coalesces background work until after the entrance and cancels on teardown", async () => {
    const outbox = new MessageOutbox("me:1");
    const work: string[] = [];
    outbox.start(message(), payload);
    outbox.deferRefresh("shared", () => work.push("old"));
    outbox.deferRefresh("shared", () => work.push("latest"));
    expect(work).toEqual([]);
    await Bun.sleep(475);
    expect(work).toEqual([]);
    await Bun.sleep(220);
    expect(work).toEqual(["latest"]);
    outbox.deferRefresh("cancelled", () => work.push("cancelled"));
    outbox.cancelRefreshes();
    await Bun.sleep(475);
    expect(work).toEqual(["latest"]);
  });
});

test("acknowledged expiring messages leave the local transcript at their deadline", () => {
  const outbox = new MessageOutbox("me:1");
  const pending = message();
  outbox.start(pending, payload);
  outbox.acknowledge({ ...pending, expiresAt: new Date(200) });
  expect(mergeOutgoingMessages([], outbox.getSnapshot(), 199)).toHaveLength(1);
  expect(mergeOutgoingMessages([], outbox.getSnapshot(), 200)).toHaveLength(0);
  outbox.retire(new Set());
  expect(outbox.getSnapshot()).toHaveLength(0);
});

test("retry cannot reuse an idempotency ID for a different payload", () => {
  const outbox = new MessageOutbox("me:1");
  outbox.start(message(), payload);
  outbox.fail("local");
  expect(() =>
    outbox.start(message(), { content: "different", type: "text" })
  ).toThrow("original message");
});

test("unsent messages survive conversation navigation and stay isolated by identity", () => {
  clearOutboxesOutsideScope("navigation:1");
  const first = getMessageOutbox("navigation:1", "chat-a");
  first.start(message(), payload);
  first.fail("local");
  expect(getMessageOutbox("navigation:1", "chat-a")).toBe(first);
  expect(getMessageOutbox("navigation:1", "chat-b").getSnapshot()).toHaveLength(
    0
  );
  clearOutboxesOutsideScope("navigation:2");
  expect(getMessageOutbox("navigation:2", "chat-a").getSnapshot()).toHaveLength(
    0
  );
  expect(getMessageOutbox("navigation:1", "chat-a")).not.toBe(first);
});
