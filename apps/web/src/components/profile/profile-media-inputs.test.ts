import { describe, expect, test } from "bun:test";

import { resolveAvatarSrc } from "@/components/profile/profile-media-inputs";

const PLACEHOLDER = "/_next/static/media/avatar-placeholder.png";

describe("resolveAvatarSrc", () => {
  test("an empty string is no picture, never a source", () => {
    // The regression this exists for. `next/image` accepts `src=""` and renders
    // an `<img>` that resolves to nothing, and React warns that the browser may
    // re-request the whole page over the network. The den create sheet spells
    // "nothing chosen yet" as `preview ?? ""`, so the empty string arrives here
    // from a real call site rather than from a hypothetical one.
    expect(resolveAvatarSrc("", PLACEHOLDER)).toBe(PLACEHOLDER);
    expect(resolveAvatarSrc("", PLACEHOLDER)).not.toBe("");
  });

  test("a static import is a picture too", () => {
    expect(
      resolveAvatarSrc(
        { height: 1, src: "/static/thing.png", width: 1 },
        PLACEHOLDER
      )
    ).toBe(PLACEHOLDER);
  });

  test("a blob preview is passed through untouched", () => {
    // An optimistic local preview is the only source the uploading client can
    // resolve; normalising it would strip the scheme and break the preview.
    const blob = "blob:http://localhost/abc-123";
    expect(resolveAvatarSrc(blob, PLACEHOLDER)).toBe(blob);
  });

  test("a real url is normalised, not replaced", () => {
    expect(resolveAvatarSrc("/api/media/media-1", PLACEHOLDER)).toBe(
      "/api/media/media-1"
    );
    expect(resolveAvatarSrc("/avatars/default-2.png", PLACEHOLDER)).toBe(
      "/avatars/default-2.png"
    );
  });
});
