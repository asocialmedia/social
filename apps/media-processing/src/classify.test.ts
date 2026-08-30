import { describe, expect, test } from "bun:test";

import { extractTextTopics, sanitizeTags } from "./classify";

describe("sanitizeTags", () => {
  test("cleans, lowercases, deduplicates, and strips hashtags", () => {
    const raw = [
      "#Linux",
      "linux",
      "  #HomeLab  ",
      "a",
      "12345678901234567890123456789012345",
      "DOCKER!!",
    ];
    const cleaned = sanitizeTags(raw);

    expect(cleaned).toContain("linux");
    expect(cleaned).toContain("homelab");
    expect(cleaned).toContain("docker");
    expect(cleaned).not.toContain("a"); // too short (<2)
    expect(cleaned.length).toBe(3);
  });
});

describe("extractTextTopics", () => {
  test("extracts tech, linux, and networking topics from speech text", () => {
    const text =
      "Today I am setting up a Linux server with Docker and Wireguard VPN for my homelab.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("linux");
    expect(topics).toContain("devops");
    expect(topics).toContain("networking");
  });

  test("extracts gaming and anime topics accurately", () => {
    const text =
      "Streaming some gameplay on Steam while watching new anime episodes.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("gaming");
    expect(topics).toContain("anime");
  });

  test("returns empty array for unrelated or empty text", () => {
    expect(extractTextTopics("")).toEqual([]);
    expect(extractTextTopics("hello world good morning")).toEqual([]);
  });
});
