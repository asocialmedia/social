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
    expect(topics).toContain("docker");
    expect(topics).toContain("homelab");
    expect(topics).toContain("wireguard-vpn");
  });

  test("extracts gaming and anime topics accurately", () => {
    const text =
      "Streaming some gameplay on Steam while watching new anime episodes.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("steam");
    expect(topics).toContain("gameplay");
    expect(topics).toContain("anime");
  });

  test("returns empty array for unrelated or empty text", () => {
    expect(extractTextTopics("")).toEqual([]);
    expect(extractTextTopics("hello world good morning")).toEqual([]);
  });

  test("extracts deep nature entities: beach, mountain, cave", () => {
    const text =
      "Exploring a subterranean cave before hiking up the alpine mountain summit and resting at the beach.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("mountain");
    expect(topics).toContain("cave");
    expect(topics).toContain("beach");
  });

  test("extracts deep automotive entities: porsche, jdm, skyline", () => {
    const text =
      "Spotted a clean Porsche 911 GT3 RS alongside an R34 Skyline in a JDM car meet.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("porsche-911-gt3-rs");
    expect(topics).toContain("r34-skyline");
    expect(topics).toContain("jdm");
  });

  test("extracts deep anime entities: jujutsu kaisen, gojo satoru", () => {
    const text =
      "Gojo Satoru using hollow purple in Jujutsu Kaisen anime episode.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("anime");
    expect(topics).toContain("jujutsu-kaisen");
  });

  test("extracts deep animal entities: golden retriever, shiba inu", () => {
    const text =
      "My golden retriever playing with a shiba inu puppy in the park.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("golden-retriever");
    expect(topics).toContain("shiba-inu");
  });

  test("extracts dynamic, open-ended entities not present in any static dictionary", () => {
    const text =
      "Testing my vintage Leica M6 rangefinder with a Summicron lens on #astrophotography and shooting Rolex Submariner macros.";
    const topics = extractTextTopics(text);

    expect(topics).toContain("astrophotography");
    expect(topics).toContain("leica-m6");
    expect(topics).toContain("summicron");
    expect(topics).toContain("rolex-submariner");
  });
});
