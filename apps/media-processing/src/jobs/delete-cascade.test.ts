import { beforeEach, expect, mock, test } from "bun:test";

const mediaId = "lifecycle-worker-fixture";
let failureCode = "CHAT_LIFECYCLE_ERASURE";
let failDelete = false;
const deleted = new Set<string>();
const originalKey = `media/${mediaId}/original.png`;
const masterKey = `derived/v1/${mediaId}/generation/hls/master.m3u8`;

mock.module("@asm/db", () => ({
  prisma: {
    orm: {
      public: {
        PostMedia: {
          first() {
            return Promise.resolve({
              failureCode,
              id: mediaId,
              key: originalKey,
              postMediaDerivatives: [{ key: masterKey }],
              status: "DELETED",
            });
          },
          include() {
            return this;
          },
          select() {
            return this;
          },
          update(data: { failureCode: string }) {
            ({ failureCode } = data);
            return Promise.resolve();
          },
          where() {
            return this;
          },
        },
      },
    },
  },
}));
mock.module("../log", () => ({
  mediaLogger: {
    info() {
      // Required logger shape.
    },
  },
  withSpan: (_name: string, task: () => Promise<void>) => task(),
}));
mock.module("../s3", () => ({
  getS3: () => ({
    file: (key: string) => ({
      delete: () => {
        if (failDelete) {
          return Promise.reject(new Error("Storage unavailable"));
        }
        deleted.add(key);
        return Promise.resolve();
      },
    }),
    list: () =>
      Promise.resolve({
        contents: [{ key: masterKey.replace("master.m3u8", "seg-1.m4s") }],
      }),
  }),
}));

const { processMediaDeleteCascade } = await import("./delete-cascade");
beforeEach(() => {
  failureCode = "CHAT_LIFECYCLE_ERASURE";
  failDelete = false;
  deleted.clear();
});

test("storage erasure includes HLS segments and releases the completed backlog row", async () => {
  await processMediaDeleteCascade({ mediaId });
  expect(deleted.has(originalKey)).toBe(true);
  expect(deleted.has(masterKey)).toBe(true);
  expect(deleted.has(masterKey.replace("master.m3u8", "seg-1.m4s"))).toBe(true);
  expect(failureCode).toBe("CHAT_LIFECYCLE_ERASED");
});

test("failed storage erasure leaves durable pending metadata and succeeds on retry", async () => {
  failDelete = true;
  await expect(processMediaDeleteCascade({ mediaId })).rejects.toThrow(
    "Storage unavailable"
  );
  expect(failureCode).toBe("CHAT_LIFECYCLE_ERASURE");
  failDelete = false;
  await processMediaDeleteCascade({ mediaId });
  expect(failureCode).toBe("CHAT_LIFECYCLE_ERASED");
});
