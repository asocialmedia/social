// oxlint-disable max-classes-per-file -- File and Directory are separate native constructors in the filesystem adapter.
import { afterAll, expect, mock, test } from "bun:test";

const events: string[] = [];
const pendingWrite = Promise.withResolvers<undefined>();

// Bun keeps a mocked module for the whole run, so the stub exports every
// binding a later test file imports from expo-file-system, Directory included.
mock.module("expo-file-system", () => ({
  Directory: class {
    readonly uri = "file:///cache/directory";
  },
  File: class {
    events = events;
    create() {
      this.events.push("create");
    }
    delete() {
      this.events.push("delete");
    }
    open() {
      return {
        close: () => this.events.push("close"),
        offset: 0,
        readBytes: (length: number) => Promise.resolve(new Uint8Array(length)),
      };
    }
    upload() {
      this.events.push("upload");
      return Promise.resolve({
        body: "",
        headers: { ETag: '"part-etag"' },
        status: 200,
      });
    }
    async write() {
      this.events.push("writing");
      await pendingWrite.promise;
      this.events.push("written");
    }
  },
  Paths: { cache: "file:///cache" },
}));

const { putFilePart } = await import("./upload-transport");

afterAll(() => mock.restore());

test("multipart upload waits for Expo's asynchronous file write before sending bytes", async () => {
  const upload = putFilePart({
    end: 8,
    onProgress: () => {},
    start: 0,
    uri: "file:///video.mp4",
    url: "https://storage.example/part",
  });

  await Promise.resolve();
  expect(events).toEqual(["create", "writing"]);
  pendingWrite.resolve();
  expect(await upload).toBe('"part-etag"');
  expect(events).toEqual([
    "create",
    "writing",
    "written",
    "close",
    "upload",
    "delete",
  ]);
});
