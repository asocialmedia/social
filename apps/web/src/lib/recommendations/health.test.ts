import { expect, mock, test } from "bun:test";

const warn = mock(() => {});
const info = mock(() => {});
mock.module("@asm/logger", () => ({ createLogger: () => ({ info, warn }) }));
const { reportRecommendationHealth } = await import("./health");

test("outages do not flood logs under concurrent demand and a successful recovery is recorded once", () => {
  for (let index = 0; index < 1000; index += 1) {
    reportRecommendationHealth("native-feed", false);
  }
  expect(warn).toHaveBeenCalledTimes(1);
  reportRecommendationHealth("native-feed", true);
  reportRecommendationHealth("native-feed", true);
  expect(info).toHaveBeenCalledTimes(1);
  reportRecommendationHealth("native-feed", false);
  expect(warn).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 100; index += 1) {
    reportRecommendationHealth("native-feed", true);
    reportRecommendationHealth("native-feed", false);
  }
  expect(warn).toHaveBeenCalledTimes(1);
  expect(info).toHaveBeenCalledTimes(1);
});
