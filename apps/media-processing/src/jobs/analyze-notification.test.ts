import { beforeEach, describe, expect, mock, test } from "bun:test";

const enqueuedRecipients: string[] = [];
const createdNotifications: unknown[] = [];
let existingNotificationResult: unknown = null;

const fakePrisma = {
  media: {
    findUnique: mock((args: { where: { id: string } }) => {
      if (args.where.id === "media-with-post") {
        return Promise.resolve({
          id: "media-with-post",
          post: { id: "post-123", isGust: false, userId: "post-author-456" },
          postId: "post-123",
          type: "VIDEO",
          userId: "uploader-789",
        });
      }
      if (args.where.id === "media-without-post") {
        return Promise.resolve({
          id: "media-without-post",
          post: null,
          postId: null,
          type: "AUDIO",
          userId: "media-owner-111",
        });
      }
      return Promise.resolve(null);
    }),
  },
  notification: {
    create: mock((args: unknown) => {
      createdNotifications.push(args);
      return Promise.resolve(args);
    }),
    findFirst: mock((_args?: unknown) =>
      Promise.resolve(existingNotificationResult)
    ),
  },
  user: {
    upsert: mock((_args?: unknown) => Promise.resolve({})),
  },
};

const SYSTEM_MODERATION_USER_ID = "sys-mod-zeph";
const enqueueNotificationCreated = mock((recipientId: string) => {
  enqueuedRecipients.push(recipientId);
  return Promise.resolve();
});

async function runTranscriptionNotification(
  mediaId: string,
  transcription: { captionsKey?: string | null; transcript?: string | null }
) {
  if (transcription?.captionsKey || transcription?.transcript) {
    const mediaWithOwner = await fakePrisma.media.findUnique({
      where: { id: mediaId },
    });

    if (mediaWithOwner) {
      const recipientId = mediaWithOwner.post?.userId ?? mediaWithOwner.userId;
      if (recipientId) {
        await fakePrisma.user.upsert({
          where: { id: SYSTEM_MODERATION_USER_ID },
        });

        const existingNotification = mediaWithOwner.postId
          ? await fakePrisma.notification.findFirst({
              where: {
                issuerId: SYSTEM_MODERATION_USER_ID,
                postId: mediaWithOwner.postId,
                recipientId,
                type: "TRANSCRIPTION",
              },
            })
          : null;

        if (!existingNotification) {
          await fakePrisma.notification.create({
            data: {
              issuerId: SYSTEM_MODERATION_USER_ID,
              postId: mediaWithOwner.postId ?? null,
              recipientId,
              type: "TRANSCRIPTION",
            },
          });
          await enqueueNotificationCreated(recipientId);
        }
      }
    }
  }
}

describe("transcription notification dispatch", () => {
  beforeEach(() => {
    enqueuedRecipients.length = 0;
    createdNotifications.length = 0;
    existingNotificationResult = null;
  });

  test("dispatches notification to post owner when post is attached", async () => {
    await runTranscriptionNotification("media-with-post", {
      captionsKey: "captions/123.vtt",
      transcript: "Hello world",
    });

    expect(createdNotifications.length).toBe(1);
    expect(enqueuedRecipients).toEqual(["post-author-456"]);
  });

  test("dispatches notification to media owner when post is null", async () => {
    await runTranscriptionNotification("media-without-post", {
      captionsKey: null,
      transcript: "Transcript only",
    });

    expect(createdNotifications.length).toBe(1);
    expect(enqueuedRecipients).toEqual(["media-owner-111"]);
  });

  test("dispatches when captionsKey is present but transcript is null", async () => {
    await runTranscriptionNotification("media-with-post", {
      captionsKey: "captions/video.vtt",
      transcript: null,
    });

    expect(createdNotifications.length).toBe(1);
    expect(enqueuedRecipients).toEqual(["post-author-456"]);
  });

  test("suppresses duplicate notification when one already exists for post", async () => {
    existingNotificationResult = { id: "existing-notif-1" };

    await runTranscriptionNotification("media-with-post", {
      captionsKey: "captions/123.vtt",
      transcript: "Hello world",
    });

    expect(createdNotifications.length).toBe(0);
    expect(enqueuedRecipients.length).toBe(0);
  });

  test("does nothing when neither captions nor transcript is produced", async () => {
    await runTranscriptionNotification("media-with-post", {
      captionsKey: null,
      transcript: null,
    });

    expect(createdNotifications.length).toBe(0);
    expect(enqueuedRecipients.length).toBe(0);
  });
});
