import { describe, expect, mock, test } from "bun:test";

import type { PushDelivery } from "@asm/notifications/server";

import { processMessagePush } from "./message-push";

const notification: PushDelivery = {
  id: "message-1",
  payload: {
    body: "Sent you a message",
    path: "/messages?c=conversation-1",
    tag: "message:conversation-1",
    title: "Alice",
  },
  recipientId: "bob",
};
const job = { messageId: "message-1", recipientId: "bob" };
const success = {
  device: { failed: 0, sent: 1, unregistered: [] },
  web: { expired: [], failed: 0, sent: 0 },
};

describe("DM push jobs", () => {
  test("dispatches an eligible message to its recipient", async () => {
    const dispatch = mock((_notification: PushDelivery) =>
      Promise.resolve(success)
    );
    await processMessagePush(job, undefined, {
      dispatch,
      load: () => Promise.resolve(notification),
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(notification);
  });

  test("skips messages no longer eligible for an alert", async () => {
    const dispatch = mock((_notification: PushDelivery) =>
      Promise.resolve(success)
    );
    await processMessagePush(job, undefined, {
      dispatch,
      load: () => Promise.resolve(null),
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("transient delivery failure retries through the queue", async () => {
    await expect(
      processMessagePush(job, undefined, {
        dispatch: () => Promise.resolve({ ...success, retryable: true }),
        load: () => Promise.resolve(notification),
      })
    ).rejects.toThrow("Message push infrastructure unavailable");
  });
});
