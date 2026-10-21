import { afterEach, expect, mock, test } from "bun:test";

import { reselectFeedNavigation } from "./feed-navigation";
import { clearFeedTopRequest, consumeFeedTop } from "./feed-top-request";

afterEach(clearFeedTopRequest);

test("active Home and Gusts navigation entries scroll their current feed without replacing the tab URL", () => {
  const event = { preventDefault: mock(() => {}) };
  reselectFeedNavigation("/", "/", event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(consumeFeedTop("home:trending:bluesky:en")).toBe(true);
  reselectFeedNavigation("/gusts", "/gusts", event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(consumeFeedTop("gusts:latest")).toBe(true);
});

test("other destinations and detail-to-feed navigation retain normal routing", () => {
  const event = { preventDefault: mock(() => {}) };
  reselectFeedNavigation("/", "/users/person", event);
  reselectFeedNavigation("/gusts", "/gusts/detail", event);
  reselectFeedNavigation("/discover", "/discover", event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(consumeFeedTop("home:latest")).toBe(false);
});
