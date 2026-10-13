import { expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import { deliverMessages } from "./deliver-messages";

test("a shared post carries its caption and reply once before staged media", async () => {
  const sent: MessagePayload[] = [];
  await deliverMessages({
    attachments: [
      {
        file: { height: 200, mimeType: "image/png", width: 100 },
        mediaId: "photo",
      },
      { file: { mimeType: "image/gif" }, mediaId: "gif" },
    ],
    caption: "Look at this",
    onSend: (payload) => {
      sent.push(payload);
      return Promise.resolve();
    },
    postId: "shared-post",
    replyTo: { id: "reply", senderId: "peer" },
  });
  expect(sent).toHaveLength(3);
  expect(sent[0]).toEqual({
    content: "Look at this",
    postId: "shared-post",
    replyToId: "reply",
    replyToSenderId: "peer",
    type: "post",
  });
  expect(sent.slice(1).map((payload) => payload.content)).toEqual([
    undefined,
    undefined,
  ]);
  expect(sent[1]).toMatchObject({
    images: [{ height: 200, url: "/api/media/photo", width: 100 }],
    kind: "image",
    type: "media",
  });
});

test("a GIF-only message retains its caption", async () => {
  const sent: MessagePayload[] = [];
  await deliverMessages({
    attachments: [{ file: { mimeType: "image/gif" }, mediaId: "gif" }],
    caption: "Animated",
    onSend: (payload) => {
      sent.push(payload);
      return Promise.resolve();
    },
    replyTo: null,
  });
  expect(sent[0]).toMatchObject({
    content: "Animated",
    kind: "gif",
    type: "media",
  });
});

test("failed post delivery stops the remaining attachments", async () => {
  let calls = 0;
  await expect(
    deliverMessages({
      attachments: [{ file: { mimeType: "image/png" }, mediaId: "photo" }],
      caption: "",
      onSend: () => {
        calls += 1;
        return Promise.reject(new Error("offline"));
      },
      postId: "post",
      replyTo: null,
    })
  ).rejects.toThrow("offline");
  expect(calls).toBe(1);
});
