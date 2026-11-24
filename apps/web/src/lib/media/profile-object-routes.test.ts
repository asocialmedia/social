import { afterEach, expect, mock, test } from "bun:test";

const cachedAvatar = mock();
const lookupUser = mock();
const readStorage = mock();

mock.module("@asm/db", () => ({
  avatarCache: { get: cachedAvatar },
  prisma: {
    orm: {
      public: {
        Users: { select: () => ({ where: () => ({ first: lookupUser }) }) },
      },
    },
  },
}));

mock.module("@/lib/media/object-storage", () => ({
  ASMOB_BUCKET: "uploads",
  asmobClient: { send: readStorage },
}));

const { GET: readAvatar } =
  await import("@/app/api/users/avatar/[userId]/image/route");
const { GET: readBanner } =
  await import("@/app/api/users/banner/[userId]/image/route");
const context = { params: Promise.resolve({ userId: "reader" }) };
const request = new Request("https://asm.test");

afterEach(() => {
  cachedAvatar.mockReset();
  lookupUser.mockReset();
  readStorage.mockReset();
});

test("an avatar cache failure still reads the avatar key and serves its stored image", async () => {
  cachedAvatar.mockRejectedValue(new Error("cache unavailable"));
  lookupUser.mockResolvedValue({ avatarKey: "avatars/reader/image.png" });
  readStorage.mockResolvedValue({
    Body: { transformToWebStream: () => new Response("avatar").body },
    ContentLength: 6,
    ContentType: "image/png",
  });
  const response = await readAvatar(request, context);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("avatar");
  expect(lookupUser).toHaveBeenCalledTimes(1);
});

test("an unavailable avatar bucket yields a fallback that will not stick in cache", async () => {
  cachedAvatar.mockResolvedValue({ key: "avatars/reader/image.png" });
  readStorage.mockRejectedValue({ name: "NoSuchBucket" });
  const response = await readAvatar(request, context);
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(readStorage).toHaveBeenCalledTimes(2);
});

test("an unavailable banner bucket produces a retryable 503", async () => {
  lookupUser.mockResolvedValue({ bannerKey: "banners/reader/image.png" });
  readStorage.mockRejectedValue({ name: "NoSuchBucket" });
  const response = await readBanner(request, context);
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("5");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
