// HTTP contract assertions keep each response status beside its request.
// oxlint-disable unicorn/no-await-expression-member
import { expect, mock, test } from "bun:test";

import { createClassifierApp } from "./app";
import { classifierConfig } from "./config";
import { ClassifierError } from "./error";
import { maxImageBytes } from "./model";
import type { Classification } from "./model";

const token = "classifier_test_token_01234567890123456789";
const config = classifierConfig({ CLASSIFIER_API_TOKEN: token });
const result: Classification = {
  label: "SFW",
  probabilities: { NSFL: 0.01, NSFW: 0.01, SFW: 0.98 },
  timing: { decodeMs: 1, inferenceMs: 2 },
};
const request = (path = "/v1/classify", options: RequestInit = {}) =>
  new Request(`http://classifier${path}`, {
    body: new Uint8Array([1, 2, 3]),
    headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
    method: "POST",
    ...options,
  });

test("unauthenticated clients cannot consume inference or read service metrics", async () => {
  const classify = mock((_image: Uint8Array) => Promise.resolve(result));
  const app = createClassifierApp(config, classify);
  expect((await app(request("/v1/classify", { headers: {} }))).status).toBe(
    401
  );
  expect((await app(new Request("http://classifier/v1/model"))).status).toBe(
    401
  );
  expect((await app(new Request("http://classifier/ready"))).status).toBe(200);
  expect(classify).not.toHaveBeenCalled();
});

test("the API returns real class probabilities and a pinned model identity", async () => {
  const classify = mock((_image: Uint8Array) => Promise.resolve(result));
  const response = await createClassifierApp(config, classify)(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    label: "SFW",
    model: { revision: "54f4560bd9c5ee92d45dc30418a8f8680e80de6d" },
    probabilities: result.probabilities,
  });
  expect(classify.mock.calls[0]).toEqual([new Uint8Array([1, 2, 3])]);
});

test("URL payloads, oversize streams and invalid images never become a safe result", async () => {
  const classify = mock((_image: Uint8Array) => Promise.resolve(result));
  const app = createClassifierApp(config, classify);
  expect(
    (
      await app(
        request("/v1/classify", {
          body: JSON.stringify({ url: "http://localhost/private" }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
        })
      )
    ).status
  ).toBe(415);
  expect(
    (
      await app(
        request("/v1/classify", { body: new Uint8Array(maxImageBytes + 1) })
      )
    ).status
  ).toBe(413);
  expect(classify).not.toHaveBeenCalled();
  const invalid = createClassifierApp(config, () =>
    Promise.reject(new ClassifierError("invalid_image", 422))
  );
  expect((await invalid(request())).status).toBe(422);
});

test("a stalled upload is cancelled and releases inference capacity", async () => {
  const classify = mock((_image: Uint8Array) => Promise.resolve(result));
  const app = createClassifierApp(
    { ...config, requestTimeoutMs: 10 },
    classify
  );
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const response = await app(request("/v1/classify", { body: stream }));
  expect(response.status).toBe(408);
  expect(classify).not.toHaveBeenCalled();
  expect((await app(request())).status).toBe(200);
});

test("one active inference plus a full queue rejects excess work with Retry-After", async () => {
  const gate = Promise.withResolvers<Classification>();
  const entered = Promise.withResolvers<undefined>();
  const app = createClassifierApp({ ...config, queueLimit: 1 }, () => {
    entered.resolve();
    return gate.promise;
  });
  const active = app(request());
  await entered.promise;
  const waiting = app(request());
  const rejected = await app(request());
  expect(rejected.status).toBe(503);
  expect(rejected.headers.get("retry-after")).toBe("1");
  gate.resolve(result);
  expect((await active).status).toBe(200);
  expect((await waiting).status).toBe(200);
});
