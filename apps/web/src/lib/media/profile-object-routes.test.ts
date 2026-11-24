import { expect, mock, test } from "bun:test";

import { serveAvatarImage } from "@/app/api/users/avatar/[userId]/image/handler";
import { serveBannerImage } from "@/app/api/users/banner/[userId]/image/handler";

const request = new Request("https://asm.test");
const avatarKey = "avatars/reader/image.png";
const bannerKey = "banners/reader/image.png";
const unavailableBucket = Object.assign(new Error("Bucket unavailable"), {
  name: "NoSuchBucket",
});

test("an avatar cache failure still reads the avatar key and serves its stored image", async () => {
  const lookupUser = mock(() => Promise.resolve(avatarKey));
  const response = await serveAvatarImage(
    request,
    "reader",
    lookupUser,
    () =>
      Promise.resolve({
        Body: { transformToWebStream: () => new Blob(["avatar"]).stream() },
        ContentLength: 6,
        ContentType: "image/png",
      }),
    () => Promise.reject(new Error("cache unavailable"))
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("avatar");
  expect(lookupUser).toHaveBeenCalledTimes(1);
});

test("an unavailable avatar bucket yields a fallback that will not stick in cache", async () => {
  const readStorage = mock(() => Promise.reject(unavailableBucket));
  const response = await serveAvatarImage(
    request,
    "reader",
    () => Promise.resolve(null),
    readStorage,
    () => Promise.resolve(avatarKey)
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(readStorage).toHaveBeenCalledTimes(2);
});

test.each([
  unavailableBucket,
  new Error("Connection refused"),
  Object.assign(new Error("Storage returned an internal error"), {
    $metadata: { httpStatusCode: 500 },
    name: "InternalError",
  }),
])(
  "a failed banner retry returns a non-cacheable 503 (%#)",
  async (failure) => {
    const readStorage = mock(() =>
      Promise.reject(failure)
    ).mockRejectedValueOnce(unavailableBucket);
    const response = await serveBannerImage(
      request,
      "reader",
      () => Promise.resolve(bannerKey),
      readStorage
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readStorage).toHaveBeenCalledTimes(2);
  }
);

test("a confirmed missing banner remains a 404", async () => {
  const response = await serveBannerImage(
    request,
    "reader",
    () => Promise.resolve(bannerKey),
    () =>
      Promise.reject(
        Object.assign(new Error("Missing key"), { name: "NoSuchKey" })
      )
  );
  expect(response.status).toBe(404);
});
