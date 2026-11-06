import { expect, test } from "bun:test";

import { DynamicKnowledgeGraph } from "../topics/knowledge-graph";
import {
  networkContentTopics,
  networkLanguageMatches,
} from "./network-features";
import { buildUserProfile } from "./profile";

test("NLP extracts topic evidence and inflections, preserving declared multilingual tags", () => {
  const topics = networkContentTopics(
    "I collect anime figurines and play games. #manga",
    ["3d art", "日本語"]
  );
  expect(topics).toContain("anime");
  expect(topics).toContain("figurine");
  expect(topics).toContain("game");
  expect(topics).toContain("日本語");
  expect(networkContentTopics("日本の漫画", ["漫画"], ["ja"])).toEqual([
    "漫画",
  ]);
  expect(topics.length).toBeLessThanOrEqual(20);
});

test("related interests come from observed co-occurrence for arbitrary subjects", () => {
  const graph = new DynamicKnowledgeGraph();
  graph.recordCoOccurrence(
    networkContentTopics("Anime figurines and 3D art", [
      "anime",
      "figurines",
      "3d art",
    ])
  );
  graph.recordCoOccurrence(["figurines", "gaming"]);
  graph.recordCoOccurrence(["software", "frameworks", "model releases"]);
  graph.recordCoOccurrence(["orchids", "botany", "photography"]);
  const profileFor = (tag: string) =>
    buildUserProfile([{ authorId: "", kind: "interest", tags: [tag] }], {
      knowledgeGraph: graph,
    });
  expect(profileFor("anime").expandedEntityWeights?.figurines).toBeGreaterThan(
    0
  );
  expect(profileFor("anime").expandedEntityWeights?.gaming).toBeGreaterThan(0);
  expect(profileFor("anime").expandedEntityWeights?.software ?? 0).toBe(0);
  expect(
    profileFor("software").expandedEntityWeights?.frameworks
  ).toBeGreaterThan(0);
  expect(
    profileFor("orchids").expandedEntityWeights?.photography
  ).toBeGreaterThan(0);
});

test("language selection follows explicit metadata and remains neutral for uncertain short text", () => {
  expect(networkLanguageMatches("Hello", ["ja"], "en")).toBe(false);
  expect(networkLanguageMatches("Hello", ["en-IN"], "en")).toBe(true);
  expect(networkLanguageMatches("Hello", [], "ja")).toBe(true);
  expect(networkLanguageMatches("Bonjour", ["fr"], "all")).toBe(true);
  expect(networkLanguageMatches("Hello", ["ja"], ["en", "ja"])).toBe(true);
  expect(networkLanguageMatches("Hello", ["fr"], ["en", "ja"])).toBe(false);
  expect(networkLanguageMatches("Hello", ["fr"], [])).toBe(true);
});
