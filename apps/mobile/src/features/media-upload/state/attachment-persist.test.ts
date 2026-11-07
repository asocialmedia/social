import { describe, expect, test } from "bun:test";

import {
  ATTACHMENT_DRAFTS_VERSION,
  decodeStoredDrafts,
  encodeScopesForStorage,
  loadStoredDrafts,
  saveStoredDrafts,
} from "./attachment-persist";
import type { StoredAttachmentDrafts } from "./attachment-persist";

function memoryStorage(initial: string | null = null) {
  let value: string | null = initial;
  return {
    getItem: () => Promise.resolve(value),
    removeItem: () => {
      value = null;
      return Promise.resolve();
    },
    setItem: (_key: string, next: string) => {
      value = next;
      return Promise.resolve();
    },
  };
}

describe("attachment draft persistence", () => {
  test("encode stamps the storage version", () => {
    const encoded = encodeScopesForStorage({
      post: [
        {
          family: "IMAGE",
          mediaId: "m1",
          mimeType: "image/jpeg",
          name: "photo.jpg",
          purpose: "post",
        },
      ],
    });
    expect(encoded.version).toBe(ATTACHMENT_DRAFTS_VERSION);
  });

  test("decode drops stale versions and malformed rows", () => {
    expect(decodeStoredDrafts({ scopes: { post: [] }, version: 1 })).toEqual(
      {}
    );
    const stale = { scopes: { post: [{ mediaId: "m1" }] }, version: 99 };
    expect(
      decodeStoredDrafts(stale as unknown as StoredAttachmentDrafts)
    ).toEqual({});
    expect(
      decodeStoredDrafts({
        scopes: {
          post: [
            {
              family: "IMAGE",
              mediaId: "m1",
              mimeType: "image/jpeg",
              name: "photo.jpg",
              purpose: "post",
            },
            { mediaId: 42 },
            null,
          ],
        },
        version: ATTACHMENT_DRAFTS_VERSION,
      })
    ).toEqual({
      post: [
        {
          family: "IMAGE",
          mediaId: "m1",
          mimeType: "image/jpeg",
          name: "photo.jpg",
          purpose: "post",
        },
      ],
    });
  });

  test("decode drops corrupt JSON through the loader", async () => {
    expect(await loadStoredDrafts(memoryStorage("{nope"))).toEqual({});
    expect(await loadStoredDrafts(memoryStorage(null))).toEqual({});
  });

  test("save then load round-trips the scopes", async () => {
    const storage = memoryStorage();
    const scopes = {
      post: [
        {
          family: "VIDEO" as const,
          gust: true,
          mediaId: "v1",
          mimeType: "video/mp4",
          name: "clip.mp4",
          processing: true,
          purpose: "post" as const,
        },
      ],
    };
    await saveStoredDrafts(storage, scopes);
    expect(await loadStoredDrafts(storage)).toEqual(scopes);
  });
});
