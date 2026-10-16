import { expect, test } from "bun:test";

import { messageImageSource } from "./message-image-source";

const origin = "https://asocialmedia.cc";

test("private message images carry credentials and use an account-specific cache key", () => {
  const result = messageImageSource(
    "/api/media/image-id",
    origin,
    "alice",
    "session_token=opaque"
  );
  expect(result.privateMedia).toBe(true);
  expect(result.source?.headers).toEqual({
    authorization: "Bearer opaque",
    cookie: "session_token=opaque",
  });
  expect(result.source?.cacheKey).not.toContain("opaque");
  expect(result.source?.cacheKey).not.toBe(
    messageImageSource(
      "/api/media/image-id",
      origin,
      "bob",
      "session_token=other"
    ).source?.cacheKey
  );
});

test("external URLs never receive session credentials even when their path looks internal", () => {
  const result = messageImageSource(
    "https://elsewhere.invalid/api/media/image-id",
    origin,
    "alice",
    "session_token=opaque"
  );
  expect(result.privateMedia).toBe(false);
  expect(result.source).toEqual({
    uri: "https://elsewhere.invalid/api/media/image-id",
  });
});

test("private image loading waits for the signed-in account and its credentials", () => {
  expect(
    messageImageSource("/api/media/image-id", origin, "alice", null).source
  ).toBeNull();
  expect(
    messageImageSource(
      "/api/media/image-id",
      origin,
      null,
      "session_token=opaque"
    ).source
  ).toBeNull();
});

test("session rotation preserves the disk key while updating authentication", () => {
  const before = messageImageSource(
    "/api/media/image-id",
    origin,
    "alice",
    "session_token=old"
  );
  const after = messageImageSource(
    "/api/media/image-id",
    origin,
    "alice",
    "session_token=new"
  );
  expect(after.source?.cacheKey).toBe(before.source?.cacheKey);
  expect(after.source?.headers?.authorization).toBe("Bearer new");
  expect(after.source?.cacheKey).not.toContain("new");
});

test("album and fullscreen absolute URLs resolve to the same disk entry", () => {
  const album = messageImageSource(
    "/api/media/image-id",
    origin,
    "alice",
    "session_token=opaque"
  );
  const viewer = messageImageSource(
    `${origin}/api/media/image-id`,
    origin,
    "alice",
    "session_token=opaque"
  );
  expect(viewer.source).toEqual(album.source);
  expect(
    messageImageSource(
      "/api/media/different-id",
      origin,
      "alice",
      "session_token=opaque"
    ).source?.cacheKey
  ).not.toBe(album.source?.cacheKey);
});
