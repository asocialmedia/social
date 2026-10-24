import { expect, test } from "bun:test";

import { classifierConfig } from "./config";

test("production configuration requires a strong key and bounded thread and queue settings", () => {
  expect(() => classifierConfig({})).toThrow("CLASSIFIER_API_TOKEN");
  const env = {
    CLASSIFIER_API_TOKEN: "classifier_test_token_01234567890123456789",
  };
  expect(classifierConfig(env).threads).toBe(1);
  expect(() => classifierConfig({ ...env, CLASSIFIER_THREADS: "8" })).toThrow();
  expect(() =>
    classifierConfig({ ...env, CLASSIFIER_QUEUE_LIMIT: "1000" })
  ).toThrow();
});
