import { expect, mock, test } from "bun:test";

import {
  profileObjectErrorDetails,
  retryProfileObjectRead,
} from "./profile-object-read";

test("storage diagnostics keep safe error codes and status without provider details", () => {
  expect(
    profileObjectErrorDetails({
      cause: { code: "ECONNREFUSED" },
      message: "private endpoint",
    })
  ).toEqual({ code: "ECONNREFUSED" });
  expect(
    profileObjectErrorDetails({
      $metadata: { httpStatusCode: 403, requestId: "opaque-request-id" },
      name: "AccessDenied",
    })
  ).toEqual({ code: "AccessDenied", upstreamStatus: 403 });
  expect(
    profileObjectErrorDetails({
      $metadata: { httpStatusCode: 500 },
      name: "InternalError",
    })
  ).toEqual({ code: "InternalError", upstreamStatus: 500 });
  expect(
    profileObjectErrorDetails({
      code: "https://signed.example/path",
      stack: "private",
    })
  ).toEqual({ code: "unknown" });
});

test("a temporary missing bucket is retried and can return the original image", async () => {
  const read = mock(() => Promise.resolve("image bytes")).mockRejectedValueOnce(
    { Code: "NoSuchBucket" }
  );
  const result = await retryProfileObjectRead(
    read,
    new AbortController().signal
  );
  expect(result).toBe("image bytes");
  expect(read).toHaveBeenCalledTimes(2);
});

test("missing keys are not retried", async () => {
  const error = { name: "NoSuchKey" };
  const read = mock(() => Promise.reject(error));
  await expect(
    retryProfileObjectRead(read, new AbortController().signal)
  ).rejects.toEqual(error);
  expect(read).toHaveBeenCalledTimes(1);
});

test("a persistent missing bucket makes at most two requests", async () => {
  const error = { name: "NoSuchBucket" };
  const read = mock(() => Promise.reject(error));
  await expect(
    retryProfileObjectRead(read, new AbortController().signal)
  ).rejects.toEqual(error);
  expect(read).toHaveBeenCalledTimes(2);
});

test("a viewer disconnect prevents another storage request", async () => {
  const controller = new AbortController();
  const error = { name: "NoSuchBucket" };
  const read = mock(() => {
    controller.abort();
    return Promise.reject(error);
  });
  await expect(retryProfileObjectRead(read, controller.signal)).rejects.toEqual(
    error
  );
  expect(read).toHaveBeenCalledTimes(1);
});
