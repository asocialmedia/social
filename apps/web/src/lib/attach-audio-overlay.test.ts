import { beforeEach, describe, expect, mock, test } from "bun:test";

// attachAudioOverlay lives in media-pipeline but only touches @asm/db for
// state, so the DB surface is mocked wholesale (repo-wide pattern for route/
// pipeline tests) and the real @asm/media + upload-policy modules stay live.

const deletedKeys: string[] = [];
const enqueued: { jobIdSuffix?: string; mediaId: string }[] = [];

let mediaFindFirstImpl: (args: unknown) => unknown = () => null;
let mediaUpdateArgs: unknown = null;
let mediaUpdateImpl: (args: unknown) => unknown = () => ({});
let derivativeFindManyImpl: (args: unknown) => unknown = () => [];
let derivativeDeleteManyArgs: unknown = null;

interface PrismaQuery {
  where?: { id?: string };
}

mock.module("@asm/db", () => ({
  Prisma: { DbNull: null },
  consumeRateLimit: mock(() => ({ allowed: true })),
  deleteObject: mock((key: string) => {
    deletedKeys.push(key);
  }),
  enqueueMediaProcess: mock(
    (mediaId: string, options?: { jobIdSuffix?: string }) => {
      enqueued.push({ jobIdSuffix: options?.jobIdSuffix, mediaId });
    }
  ),
  prisma: {
    media: {
      findFirst: (args: unknown) => mediaFindFirstImpl(args),
      update: (args: unknown) => {
        mediaUpdateArgs = args;
        return mediaUpdateImpl(args);
      },
    },
    mediaDerivative: {
      deleteMany: (args: unknown) => {
        derivativeDeleteManyArgs = args;
        return { count: 2 };
      },
      findMany: (args: unknown) => derivativeFindManyImpl(args),
    },
  },
  redis: {
    decrby: mock(() => 1),
    get: mock(() => "0"),
    incrby: mock(() => 100),
  },
  scheduleMediaCleanup: mock(async () => {}),
}));

const { attachAudioOverlay } = await import("./media-pipeline");

const USER_ID = "user-1";
const videoRow = { id: "video-1", status: "READY", type: "VIDEO" };
const audioRow = {
  id: "audio-1",
  status: "READY",
  type: "AUDIO",
  userId: USER_ID,
};

function videoArgs(args: unknown): boolean {
  const query = args as PrismaQuery;
  return query.where?.id === "video-1";
}

beforeEach(() => {
  deletedKeys.length = 0;
  enqueued.length = 0;
  mediaUpdateArgs = null;
  derivativeDeleteManyArgs = null;
  mediaFindFirstImpl = (args: unknown) =>
    videoArgs(args) ? videoRow : audioRow;
  mediaUpdateImpl = () => ({});
  derivativeFindManyImpl = () => [];
});

describe("attachAudioOverlay", () => {
  test("attaches a ready sound to an owned video with no derivatives", async () => {
    const result = await attachAudioOverlay({
      audioOverlayId: "audio-1",
      mediaId: "video-1",
      userId: USER_ID,
    });

    expect(result).toEqual({ mediaId: "video-1", reprocessing: false });
    const update = mediaUpdateArgs as {
      data: { audioOverlayId: string };
      where: { id: string };
    };
    expect(update.data.audioOverlayId).toBe("audio-1");
    expect(update.where.id).toBe("video-1");
    expect(enqueued.length).toBe(0);
  });

  test("regenerates derivatives when the video was already processed", async () => {
    derivativeFindManyImpl = () => [{ key: "derived/a" }, { key: "derived/b" }];

    const result = await attachAudioOverlay({
      audioOverlayId: "audio-1",
      mediaId: "video-1",
      userId: USER_ID,
    });

    expect(result.reprocessing).toBe(true);
    expect(deletedKeys).toEqual(["derived/a", "derived/b"]);
    const deleteMany = derivativeDeleteManyArgs as {
      where: { mediaId: string };
    };
    expect(deleteMany.where.mediaId).toBe("video-1");
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]?.mediaId).toBe("video-1");
    // A fresh dedupe key is mandatory: the retained process-${mediaId} job
    // hash would silently dedupe a plain re-enqueue.
    expect(enqueued[0]?.jobIdSuffix).toStartWith("overlay-");
  });

  test("clearing the overlay follows the same regenerate path", async () => {
    derivativeFindManyImpl = () => [{ key: "derived/a" }];

    const result = await attachAudioOverlay({
      audioOverlayId: null,
      mediaId: "video-1",
      userId: USER_ID,
    });

    expect(result.reprocessing).toBe(true);
    const update = mediaUpdateArgs as { data: { audioOverlayId: null } };
    expect(update.data.audioOverlayId).toBeNull();
    expect(enqueued.length).toBe(1);
  });

  test("refuses rows the user does not own or that are not video", async () => {
    mediaFindFirstImpl = () => null;
    await expect(
      attachAudioOverlay({
        audioOverlayId: "audio-1",
        mediaId: "video-1",
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ name: "UploadPolicyError", status: 404 });

    mediaFindFirstImpl = (args: unknown) =>
      videoArgs(args) ? { ...videoRow, type: "IMAGE" } : audioRow;
    await expect(
      attachAudioOverlay({
        audioOverlayId: "audio-1",
        mediaId: "video-1",
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ name: "UploadPolicyError", status: 404 });
  });

  test("refuses terminal or failed video rows", async () => {
    const rejected = ["DELETED", "REJECTED", "FAILED"].map((status) => {
      mediaFindFirstImpl = (args: unknown) =>
        videoArgs(args) ? { ...videoRow, status } : audioRow;
      return expect(
        attachAudioOverlay({
          audioOverlayId: "audio-1",
          mediaId: "video-1",
          userId: USER_ID,
        })
      ).rejects.toMatchObject({ name: "UploadPolicyError", status: 404 });
    });
    await Promise.all(rejected);
  });

  test("refuses a sound the user does not own or that is not audio", async () => {
    mediaFindFirstImpl = (args: unknown) =>
      videoArgs(args) ? videoRow : { ...audioRow, userId: "someone-else" };
    await expect(
      attachAudioOverlay({
        audioOverlayId: "audio-1",
        mediaId: "video-1",
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ name: "UploadPolicyError", status: 404 });

    mediaFindFirstImpl = (args: unknown) =>
      videoArgs(args) ? videoRow : { ...audioRow, type: "VIDEO" };
    await expect(
      attachAudioOverlay({
        audioOverlayId: "audio-1",
        mediaId: "video-1",
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ name: "UploadPolicyError", status: 404 });
  });

  test("refuses a sound whose bytes are not ready", async () => {
    mediaFindFirstImpl = (args: unknown) =>
      videoArgs(args) ? videoRow : { ...audioRow, status: "SCANNING" };
    await expect(
      attachAudioOverlay({
        audioOverlayId: "audio-1",
        mediaId: "video-1",
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ name: "UploadPolicyError", status: 409 });
  });

  test("maps the unique-constraint violation to a friendly conflict", async () => {
    mediaUpdateImpl = () => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
    };
    await expect(
      attachAudioOverlay({
        audioOverlayId: "audio-1",
        mediaId: "video-1",
        userId: USER_ID,
      })
    ).rejects.toMatchObject({
      name: "UploadPolicyError",
      status: 409,
    });
  });
});
