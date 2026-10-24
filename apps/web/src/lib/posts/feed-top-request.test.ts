import { describe, expect, test } from "bun:test";

import {
  clearFeedTopRequest,
  consumeFeedTop,
  requestFeedTop,
  subscribeFeedTopRequests,
} from "./feed-top-request";

describe("feed top request", () => {
  test("is claimed once, and only by the feed that asked", () => {
    requestFeedTop("home:latest");
    expect(consumeFeedTop("home:latest")).toBe(true);
    expect(consumeFeedTop("home:latest")).toBe(false);
  });

  test("a different feed cannot claim it", () => {
    requestFeedTop("home:latest");
    expect(consumeFeedTop("home:trending")).toBe(false);
    expect(consumeFeedTop("home:latest")).toBe(true);
  });

  test("notifies subscribers so a visible feed can react", () => {
    let notified = 0;
    const unsubscribe = subscribeFeedTopRequests(() => {
      notified += 1;
    });
    requestFeedTop("home:latest");
    unsubscribe();
    requestFeedTop("home:latest");
    expect(notified).toBe(1);
    clearFeedTopRequest();
  });

  test("can be dropped so a stale request cannot hijack a later visit", () => {
    requestFeedTop("home:latest");
    clearFeedTopRequest();
    expect(consumeFeedTop("home:latest")).toBe(false);
  });
});

test("a feed reselection targets its current source/locale variant without affecting another tab", () => {
  requestFeedTop("home:latest");
  expect(consumeFeedTop("home:following")).toBe(false);
  expect(consumeFeedTop("home:latestness:all:en")).toBe(false);
  expect(consumeFeedTop("home:latest:bluesky:en")).toBe(true);
  expect(consumeFeedTop("home:latest:asm:en")).toBe(false);
  requestFeedTop("gusts");
  expect(consumeFeedTop("home:latest")).toBe(false);
  expect(consumeFeedTop("gusts:following")).toBe(true);
});
