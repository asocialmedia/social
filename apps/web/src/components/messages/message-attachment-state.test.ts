import { describe, expect, test } from "bun:test";

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

import type {
  MessageAttachmentDraft,
  StagedMediaId,
} from "./message-attachment-state";
import {
  claimStagedMedia,
  groupReadyAttachments,
  hasUploading,
  isAllowedMessageImage,
  isMediaReferenced,
  isReadyToSend,
  kindForFile,
  restoreStagedMedia,
  selectAcceptedFiles,
} from "./message-attachment-state";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

function draft(
  overrides: Partial<MessageAttachmentDraft> & { id: string }
): MessageAttachmentDraft {
  return {
    file: file("a.png", "image/png"),
    height: 100,
    kind: "image",
    objectUrl: `blob:${overrides.id}`,
    progress: 100,
    stage: "processing",
    status: "ready",
    width: 100,
    ...overrides,
  };
}

function entries(
  ...pairs: [string, StagedMediaId][]
): Map<string, StagedMediaId> {
  return new Map(pairs);
}

describe("isAllowedMessageImage", () => {
  test("accepts raster images and GIFs", () => {
    expect(isAllowedMessageImage(file("a.png", "image/png"))).toBe(true);
    expect(isAllowedMessageImage(file("a.jpg", "image/jpeg"))).toBe(true);
    expect(isAllowedMessageImage(file("a.gif", "image/gif"))).toBe(true);
  });

  test("rejects SVG and non-images", () => {
    expect(isAllowedMessageImage(file("a.svg", "image/svg+xml"))).toBe(false);
    expect(isAllowedMessageImage(file("a.pdf", "application/pdf"))).toBe(false);
    expect(isAllowedMessageImage(file("a.txt", "text/plain"))).toBe(false);
  });
});

describe("kindForFile", () => {
  test("marks GIFs distinctly so their animation is preserved on render", () => {
    expect(kindForFile(file("a.gif", "image/gif"))).toBe("gif");
    expect(kindForFile(file("a.png", "image/png"))).toBe("image");
    expect(kindForFile(file("a.webp", "image/webp"))).toBe("image");
  });
});

describe("selectAcceptedFiles", () => {
  test("accepts everything under the cap", () => {
    const files = [file("a.png", "image/png"), file("b.gif", "image/gif")];
    const result = selectAcceptedFiles(0, files);
    expect(result.accepted).toEqual(files);
    expect(result.overflow).toBe(0);
    expect(result.rejected).toBe(0);
  });

  test("caps at the remaining capacity and reports overflow", () => {
    const files = Array.from({ length: 12 }, (_, index) =>
      file(`${index}.png`, "image/png")
    );
    const result = selectAcceptedFiles(MAX_MESSAGE_ATTACHMENTS - 3, files);
    expect(result.accepted).toHaveLength(3);
    expect(result.overflow).toBe(9);
    expect(result.rejected).toBe(0);
  });

  test("separates rejected files from the cap math", () => {
    const result = selectAcceptedFiles(0, [
      file("a.png", "image/png"),
      file("a.svg", "image/svg+xml"),
      file("a.pdf", "application/pdf"),
      file("b.gif", "image/gif"),
    ]);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toBe(2);
    expect(result.overflow).toBe(0);
  });

  test("accepts nothing when already at capacity", () => {
    const result = selectAcceptedFiles(MAX_MESSAGE_ATTACHMENTS, [
      file("a.png", "image/png"),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.overflow).toBe(1);
  });
});

describe("readiness", () => {
  test("isReadyToSend requires at least one fully-uploaded item", () => {
    expect(isReadyToSend([])).toBe(false);
    expect(isReadyToSend([draft({ id: "1", status: "uploading" })])).toBe(
      false
    );
    expect(isReadyToSend([draft({ id: "1", status: "error" })])).toBe(false);
    expect(isReadyToSend([draft({ id: "1" })])).toBe(true);
    expect(
      isReadyToSend([
        draft({ id: "1" }),
        draft({ id: "2", status: "uploading" }),
      ])
    ).toBe(false);
  });

  test("hasUploading reports any in-flight item", () => {
    expect(hasUploading([draft({ id: "1" })])).toBe(false);
    expect(hasUploading([draft({ id: "1", status: "uploading" })])).toBe(true);
  });
});

describe("groupReadyAttachments", () => {
  test("groups by kind and preserves order", () => {
    const groups = groupReadyAttachments([
      draft({ id: "img1", kind: "image", mediaUrl: "/api/media/1" }),
      draft({ id: "gif1", kind: "gif", mediaUrl: "/api/media/2" }),
      draft({ id: "img2", kind: "image", mediaUrl: "/api/media/3" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      attachmentIds: ["img1", "img2"],
      images: [
        { height: 100, url: "/api/media/1", width: 100 },
        { height: 100, url: "/api/media/3", width: 100 },
      ],
      kind: "image",
    });
    expect(groups[1]).toEqual({
      attachmentIds: ["gif1"],
      images: [{ height: 100, url: "/api/media/2", width: 100 }],
      kind: "gif",
    });
  });

  test("skips items that are not ready or have no media url", () => {
    const groups = groupReadyAttachments([
      draft({ id: "1", mediaUrl: undefined, status: "uploading" }),
      draft({ id: "2", mediaUrl: undefined, status: "error" }),
      draft({ id: "3", mediaUrl: undefined }),
    ]);
    expect(groups).toEqual([]);
  });

  test("drops null dimensions from the encrypted payload", () => {
    const groups = groupReadyAttachments([
      draft({ height: null, id: "1", mediaUrl: "/api/media/1", width: null }),
    ]);
    expect(groups[0].images[0]).toEqual({ url: "/api/media/1" });
  });
});

describe("isMediaReferenced", () => {
  test("detects another draft still holding the same media row", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m1", owned: false }]
    );
    expect(isMediaReferenced(map, "m1", new Set(["a"]))).toBe(true);
  });

  test("ignores drafts that are part of the same removal batch", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m1", owned: false }]
    );
    expect(isMediaReferenced(map, "m1", new Set(["a", "b"]))).toBe(false);
  });

  test("returns false when the last reference is gone", () => {
    const map = entries(["a", { mediaId: "m1", owned: true }]);
    expect(isMediaReferenced(map, "m1", new Set(["a"]))).toBe(false);
  });

  test("distinguishes media ids", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }]
    );
    expect(isMediaReferenced(map, "m1", new Set(["a"]))).toBe(false);
  });
});

describe("claimStagedMedia", () => {
  test("detaches the group so the unmount sweep cannot discard it", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }]
    );
    const claimed = claimStagedMedia(map, ["a"]);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(claimed.get("a")).toEqual({ mediaId: "m1", owned: true });
  });

  test("claims a whole group, so no sent row stays discardable", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }],
      ["c", { mediaId: "m3", owned: true }]
    );
    claimStagedMedia(map, ["a", "b"]);
    expect([...map.keys()]).toEqual(["c"]);
  });

  test("tolerates ids that never registered a row", () => {
    const map = entries(["a", { mediaId: "m1", owned: true }]);
    const claimed = claimStagedMedia(map, ["a", "missing"]);
    expect(map.size).toBe(0);
    expect(claimed.get("missing")).toBeUndefined();
  });
});

describe("restoreStagedMedia", () => {
  test("re-stages a group whose send never landed", () => {
    const map = entries(
      ["a", { mediaId: "m1", owned: true }],
      ["b", { mediaId: "m2", owned: true }]
    );
    const claimed = claimStagedMedia(map, ["a", "b"]);
    expect(map.size).toBe(0);
    restoreStagedMedia(map, claimed);
    expect(map.get("a")).toEqual({ mediaId: "m1", owned: true });
    expect(map.get("b")).toEqual({ mediaId: "m2", owned: true });
  });

  test("does not clobber a row registered since the claim", () => {
    const map = entries();
    const claimed = claimStagedMedia(
      entries(["a", { mediaId: "m1", owned: true }]),
      ["a"]
    );
    map.set("a", { mediaId: "m9", owned: true });
    restoreStagedMedia(map, claimed);
    expect(map.get("a")).toEqual({ mediaId: "m9", owned: true });
  });
});
