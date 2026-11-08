// oxlint-disable max-classes-per-file -- File and Directory are separate native constructors in the filesystem adapter.
import { beforeEach, expect, mock, test } from "bun:test";

const files = new Set<string>();
let failDelete = false;
let downloaded: (uri: string) => Promise<string>;
class CachedDirectory {
  readonly uri = "file://cache/asm-view-once";
  exists = true;
  create() {
    this.exists = true;
  }
  delete() {
    this.exists = false;
    files.clear();
  }
}
class CachedFile {
  readonly uri: string;
  constructor(directory: string | CachedDirectory, name?: string) {
    this.uri =
      typeof directory === "string" ? directory : `${directory.uri}/${name}`;
  }
  get exists() {
    return files.has(this.uri);
  }
  delete() {
    if (failDelete) {
      throw new Error("file unavailable");
    }
    files.delete(this.uri);
  }
  static async downloadFileAsync(_url: string, destination: CachedFile) {
    return { uri: await downloaded(destination.uri) };
  }
}
mock.module("expo-file-system", () => ({
  Directory: CachedDirectory,
  File: CachedFile,
  Paths: { cache: "file://cache" },
}));
const { deleteViewOncePhoto, openViewOnceMedia } =
  await import("./view-once-client");

function testFetch(
  handler: (input: RequestInfo | URL) => Promise<Response>
): typeof fetch {
  return Object.assign(handler, { preconnect: () => {} });
}

beforeEach(() => {
  files.clear();
  failDelete = false;
});

test("a cancelled native download cannot retain a late photo", async () => {
  const controller = new AbortController();
  downloaded = (uri) => {
    files.add(uri);
    controller.abort();
    return Promise.resolve(uri);
  };
  const requests: string[] = [];
  await expect(
    openViewOnceMedia(
      "chat",
      "photo",
      "grant",
      {
        apiBase: "https://example.test",
        baseFetch: testFetch((input) => {
          requests.push(String(input));
          return Promise.resolve(Response.json({ ready: true }));
        }),
      },
      controller.signal
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(files.size).toBe(0);
  expect(requests.at(-1)).toEndWith("/view-once/close");
});

test("a consumed photo stops before any native file download", async () => {
  let calls = 0;
  downloaded = (uri) => {
    calls += 1;
    return Promise.resolve(uri);
  };
  await expect(
    openViewOnceMedia("chat", "photo", "grant", {
      apiBase: "https://example.test",
      baseFetch: testFetch(() =>
        Promise.resolve(
          Response.json({ error: "Already opened" }, { status: 410 })
        )
      ),
    })
  ).rejects.toMatchObject({ status: 410 });
  expect(calls).toBe(0);
});

test("a file deletion failure cannot interrupt viewer dismissal", () => {
  const uri = "file://cache/asm-view-once/photo.image";
  files.add(uri);
  failDelete = true;
  expect(() => deleteViewOncePhoto(uri)).not.toThrow();
});
