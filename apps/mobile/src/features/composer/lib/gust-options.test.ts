import { describe, expect, test } from "bun:test";

import {
  gustAssetPatch,
  gustAssetRoute,
  gustRelations,
  prepareGustAsset,
} from "./gust-options";

describe("Gust editor metadata", () => {
  test("patches the existing owner-only sound and thumbnail routes", () => {
    expect(gustAssetRoute("video/id", "sound")).toBe(
      "/api/media/video%2Fid/audio-overlay"
    );
    expect(gustAssetPatch("sound", "sound-id")).toEqual({
      audioOverlayId: "sound-id",
    });
    expect(gustAssetPatch("thumbnail", null)).toEqual({
      thumbnailMediaId: null,
    });
  });
  test("explicit tags and people publish without caption tokens", () => {
    expect(
      gustRelations(
        { mentions: ["one"], tags: ["art"] },
        { mentions: [{ id: "one" }, { id: "two" }], tags: ["Art", "video"] }
      )
    ).toEqual({ mentions: ["one", "two"], tags: ["art", "video"] });
  });
  test("a patch retry reuses the uploaded file instead of uploading twice", async () => {
    let uploads = 0;
    let uploaded: string | undefined;
    const patches: string[] = [];
    const options = {
      isCurrent: () => true,
      onUploaded: (id: string) => {
        uploaded = id;
      },
      patch: async (id: string) => {
        await Promise.resolve();
        patches.push(id);
        if (patches.length === 1) {
          throw new Error("offline");
        }
      },
      upload: async () => {
        await Promise.resolve();
        uploads += 1;
        return { mediaId: "ready-id", status: "READY" };
      },
    };
    await expect(prepareGustAsset(options)).rejects.toThrow("offline");
    expect(
      await prepareGustAsset({ ...options, existingReadyId: uploaded })
    ).toBe("ready-id");
    expect(uploads).toBe(1);
    expect(patches).toEqual(["ready-id", "ready-id"]);
  });
  test("changing the clip while uploading never patches the replacement clip", async () => {
    let current = true;
    let patched = false;
    expect(
      await prepareGustAsset({
        isCurrent: () => current,
        onUploaded: () => {},
        patch: async () => {
          await Promise.resolve();
          patched = true;
        },
        upload: async () => {
          await Promise.resolve();
          current = false;
          return { mediaId: "old-id", status: "READY" };
        },
      })
    ).toBeNull();
    expect(patched).toBe(false);
  });
  test("unfinished processing cannot attach a sound or cover", async () => {
    await expect(
      prepareGustAsset({
        isCurrent: () => true,
        onUploaded: () => {},
        patch: async () => {
          await Promise.resolve();
        },
        upload: async () => {
          await Promise.resolve();
          return { mediaId: "pending-id", status: "DETACHED" };
        },
      })
    ).rejects.toThrow("still processing");
  });
});
