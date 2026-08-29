import { beforeEach, describe, expect, mock, test } from "bun:test";

import { computeFileSha256 } from "./media-upload-client";

let mediaFindFirstImpl: (args: unknown) => unknown = () => null;
let mediaCreateArgs: unknown = null;
let mediaUpdateArgs: unknown = null;
let derivativeCreateManyArgs: unknown = null;
let scheduledCleanups: string[] = [];

mock.module("@asm/db", () => ({
  Prisma: {
    DbNull: null,
  },
  consumeRateLimit: mock(() => ({ allowed: true })),
  prisma: {
    media: {
      count: mock(() => 0),
      create: mock((args: unknown) => {
        mediaCreateArgs = args;
        return {
          id: "new-media-id",
          status: "UPLOADING",
          ...(args as { data: Record<string, unknown> }).data,
        };
      }),
      findFirst: (args: unknown) => mediaFindFirstImpl(args),
      update: mock((args: unknown) => {
        mediaUpdateArgs = args;
        return {
          id: "updated-media-id",
          ...(args as { data: Record<string, unknown> }).data,
        };
      }),
    },
    mediaDerivative: {
      createMany: mock((args: unknown) => {
        derivativeCreateManyArgs = args;
        return { count: 1 };
      }),
      findMany: mock(() => [
        {
          durationMs: null,
          height: 720,
          id: "deriv-1",
          key: "media/video-1/720p.mp4",
          kind: "video_mp4",
          mediaId: "existing-media-id",
          mimeType: "video/mp4",
          pipelineVersion: "1.0",
          sizeBytes: 1024,
          variant: "720p",
          width: 1280,
        },
      ]),
    },
  },
  redis: {
    get: mock(() => "0"),
    incrby: mock(() => 100),
  },
  scheduleMediaCleanup: mock((mediaId: string) => {
    scheduledCleanups.push(mediaId);
  }),
}));

const { createInitiatedUpload } = await import("./media-pipeline");

const USER_ID = "user-test-123";
const TEST_SHA256 =
  "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

beforeEach(() => {
  mediaFindFirstImpl = () => null;
  mediaCreateArgs = null;
  mediaUpdateArgs = null;
  derivativeCreateManyArgs = null;
  scheduledCleanups = [];
});

describe("computeFileSha256", () => {
  test("computes correct SHA-256 for a known string buffer", async () => {
    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
    const hash = await computeFileSha256(file);
    expect(hash).toBe(TEST_SHA256);
  });
});

describe("createInitiatedUpload deduplication", () => {
  test("returns uploadUrl for new upload with no existing match", async () => {
    const result = await createInitiatedUpload({
      declaredMime: "image/png",
      fileName: "image.png",
      fileSize: 1024,
      purpose: "post",
      sha256: TEST_SHA256,
      userId: USER_ID,
    });

    expect(result.deduplicated).toBeFalsy();
    expect(result.uploadUrl).toBeString();
    expect(result.mediaId).toBeString();
  });

  test("instantly reuses unattached READY draft without generating uploadUrl", async () => {
    mediaFindFirstImpl = () => ({
      avatarOf: null,
      bannerOf: null,
      commentId: null,
      id: "ready-draft-id",
      postId: null,
      publishedKey: "media/ready-draft-id.png",
      sha256: TEST_SHA256,
      size: 1024,
      status: "READY",
      type: "IMAGE",
      userId: USER_ID,
    });

    const result = await createInitiatedUpload({
      declaredMime: "image/png",
      fileName: "image.png",
      fileSize: 1024,
      purpose: "post",
      sha256: TEST_SHA256,
      userId: USER_ID,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.status).toBe("READY");
    expect(result.uploadUrl).toBeNull();
    expect(result.mediaId).toBe("ready-draft-id");
    expect(scheduledCleanups).toContain("ready-draft-id");
  });

  test("revives soft-discarded (DELETED) draft with intact publishedKey", async () => {
    mediaFindFirstImpl = () => ({
      avatarOf: null,
      bannerOf: null,
      commentId: null,
      id: "discarded-draft-id",
      postId: null,
      publishedKey: "media/discarded-draft-id.mp4",
      sha256: TEST_SHA256,
      size: 5000,
      status: "DELETED",
      type: "VIDEO",
      userId: USER_ID,
    });

    const result = await createInitiatedUpload({
      declaredMime: "video/mp4",
      fileName: "video.mp4",
      fileSize: 5000,
      purpose: "post",
      sha256: TEST_SHA256,
      userId: USER_ID,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.status).toBe("READY");
    expect(result.uploadUrl).toBeNull();
    expect(result.mediaId).toBe("discarded-draft-id");

    const update = mediaUpdateArgs as {
      data: { status: string };
      where: { id: string };
    };
    expect(update.data.status).toBe("READY");
    expect(update.where.id).toBe("discarded-draft-id");
    expect(scheduledCleanups).toContain("discarded-draft-id");
  });

  test("joins in-flight PROCESSING unattached draft without re-uploading bytes", async () => {
    mediaFindFirstImpl = () => ({
      avatarOf: null,
      bannerOf: null,
      commentId: null,
      id: "processing-draft-id",
      postId: null,
      publishedKey: null,
      sha256: TEST_SHA256,
      size: 5000,
      status: "PROCESSING",
      type: "VIDEO",
      userId: USER_ID,
    });

    const result = await createInitiatedUpload({
      declaredMime: "video/mp4",
      fileName: "video.mp4",
      fileSize: 5000,
      purpose: "post",
      sha256: TEST_SHA256,
      userId: USER_ID,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.status).toBe("PROCESSING");
    expect(result.uploadUrl).toBeNull();
    expect(result.mediaId).toBe("processing-draft-id");
    expect(scheduledCleanups).toContain("processing-draft-id");
  });

  test("clones media and derivatives when reusing a READY media already attached to a post", async () => {
    mediaFindFirstImpl = () => ({
      aiGenerated: false,
      avatarOf: null,
      bannerOf: null,
      blurDataUrl: "data:image/webp;base64,abc",
      claimedMime: "video/mp4",
      commentId: null,
      detectedMime: "video/mp4",
      encoderVersion: "1.0",
      exifStripped: true,
      hasHls: false,
      height: 720,
      id: "attached-media-id",
      key: "media/attached-media-id.mp4",
      mimeType: "video/mp4",
      pipelineVersion: "1.0",
      platform: "asocialmedia.cc",
      postId: "existing-post-id",
      publishedKey: "media/attached-media-id.mp4",
      sha256: TEST_SHA256,
      size: 5000,
      status: "READY",
      thumbnailHeight: 360,
      thumbnailKey: "media/attached-media-id-thumb.jpg",
      thumbnailWidth: 640,
      type: "VIDEO",
      uploaderDisplayName: "Test",
      uploaderUsername: "test",
      url: "https://asmob.example.com/media/attached-media-id.mp4",
      userId: USER_ID,
      width: 1280,
    });

    const result = await createInitiatedUpload({
      declaredMime: "video/mp4",
      fileName: "video-clone.mp4",
      fileSize: 5000,
      purpose: "post",
      sha256: TEST_SHA256,
      userId: USER_ID,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.status).toBe("READY");
    expect(result.uploadUrl).toBeNull();
    expect(result.mediaId).toBe("new-media-id");

    const createArgs = mediaCreateArgs as {
      data: { publishedKey: string; status: string };
    };
    expect(createArgs.data.status).toBe("READY");
    expect(createArgs.data.publishedKey).toBe("media/attached-media-id.mp4");

    const derivArgs = derivativeCreateManyArgs as {
      data: { mediaId: string; variant: string }[];
    };
    expect(derivArgs.data.length).toBe(1);
    expect(derivArgs.data[0]?.variant).toBe("720p");
    expect(derivArgs.data[0]?.mediaId).toBe("new-media-id");
  });
});
