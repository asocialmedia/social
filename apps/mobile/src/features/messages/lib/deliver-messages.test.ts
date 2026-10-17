import { expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import { deliverMessages } from "./deliver-messages";

test("a shared post carries its caption and reply once before staged media", async () => {
  const sent: MessagePayload[] = [];
  await deliverMessages({
    attachments: [
      {
        file: {
          height: 200,
          mimeType: "image/png",
          name: "photo.png",
          size: 20,
          width: 100,
        },
        mediaId: "photo",
      },
      {
        file: { mimeType: "image/gif", name: "loop.gif", size: 30 },
        mediaId: "gif",
      },
      {
        file: { mimeType: "video/mp4", name: "clip.mp4", size: 40 },
        mediaId: "video",
      },
      {
        file: { mimeType: "application/pdf", name: "notes.pdf", size: 50 },
        mediaId: "doc",
      },
    ],
    caption: "Look at this",
    onSend: (payload) => {
      sent.push(payload);
      return Promise.resolve();
    },
    postId: "shared-post",
    replyTo: { id: "reply", senderId: "peer" },
  });
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual({
    content: "Look at this",
    postId: "shared-post",
    replyToId: "reply",
    replyToSenderId: "peer",
    type: "post",
  });
  expect(sent[1]?.content).toBeUndefined();
  expect(sent[1]).toMatchObject({
    attachments: [
      { height: 200, kind: "image", url: "/api/media/photo", width: 100 },
      { kind: "gif", url: "/api/media/gif" },
      { kind: "video", url: "/api/media/video" },
      {
        bytes: 50,
        filename: "notes.pdf",
        kind: "file",
        mimeType: "application/pdf",
        url: "/api/media/doc",
      },
    ],
    type: "media",
  });
});

test("a GIF-only message retains its caption", async () => {
  const sent: MessagePayload[] = [];
  await deliverMessages({
    attachments: [
      {
        file: { mimeType: "image/gif", name: "loop.gif", size: 30 },
        mediaId: "gif",
      },
    ],
    caption: "Animated",
    onSend: (payload) => {
      sent.push(payload);
      return Promise.resolve();
    },
    replyTo: null,
  });
  expect(sent[0]).toMatchObject({
    attachments: [{ kind: "gif", url: "/api/media/gif" }],
    content: "Animated",
    type: "media",
  });
});

test("failed post delivery stops the remaining attachments", async () => {
  let calls = 0;
  await expect(
    deliverMessages({
      attachments: [
        {
          file: { mimeType: "image/png", name: "photo.png", size: 20 },
          mediaId: "photo",
        },
      ],
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
