import { beforeEach, describe, expect, test } from "bun:test";

import { DynamicKnowledgeGraph } from "./knowledge-graph";

describe("DynamicKnowledgeGraph", () => {
  let kg: DynamicKnowledgeGraph;

  beforeEach(() => {
    kg = new DynamicKnowledgeGraph();
  });

  test("upserts dynamic entities with automatic weight accumulation", () => {
    kg.upsertEntity({
      id: "porsche-911",
      name: "Porsche 911",
      type: "technology",
    });
    expect(kg.nodeCount).toBe(1);

    const first = kg.getEntity("porsche-911");
    expect(first?.weight).toBe(1);

    // Second observation increments weight
    kg.upsertEntity({ id: "porsche-911", name: "Porsche 911" });
    expect(kg.nodeCount).toBe(1);
    expect(kg.getEntity("porsche-911")?.weight).toBe(2);
  });

  test("records co-occurrence and connects mutual edges dynamically", () => {
    kg.recordCoOccurrence(["gojo-satoru", "jujutsu-kaisen", "shonen-anime"]);

    expect(kg.nodeCount).toBe(3);

    const gojoNeighbors = kg.getNeighbors("gojo-satoru");
    expect(gojoNeighbors.length).toBe(2);
    expect(gojoNeighbors.map((n) => n.id)).toContain("jujutsu-kaisen");
    expect(gojoNeighbors.map((n) => n.id)).toContain("shonen-anime");

    // Repeat co-occurrence strengthens the relationship edge
    kg.recordCoOccurrence(["gojo-satoru", "jujutsu-kaisen"]);
    const updated = kg.getNeighbors("gojo-satoru");
    const jjkEdge = updated.find((n) => n.id === "jujutsu-kaisen");
    expect(jjkEdge?.weight).toBe(2);
  });

  test("spreading activation traverses graph edges to expand user interests", () => {
    // Build a learned dynamic graph:
    // Gojo -> Jujutsu Kaisen -> MAPPA -> Chainsaw Man
    kg.addEdge("gojo-satoru", "jujutsu-kaisen", "part_of", 10);
    kg.addEdge("jujutsu-kaisen", "mappa", "created_by", 8);
    kg.addEdge("mappa", "chainsaw-man", "created_by", 7);

    // User only interacted with "gojo-satoru"
    const activated = kg.spreadingActivation({ "gojo-satoru": 1 });

    // Activation spreads to immediate neighbors with distance decay; with default maxDepth 2, Chainsaw Man is 3 hops away and should not be reached
    expect(activated["gojo-satoru"]).toBe(1);
    expect(activated["jujutsu-kaisen"]).toBeGreaterThan(0);
    expect(activated["mappa"]).toBeGreaterThan(0);
    expect(activated["jujutsu-kaisen"]).toBeGreaterThan(activated["mappa"]);
    expect(activated["chainsaw-man"]).toBeUndefined();
  });

  test("isolates unrelated subgraphs cleanly", () => {
    // Graph A: Automotive
    kg.addEdge("porsche-911", "track-day", "related_to", 5);
    // Graph B: Baking
    kg.addEdge("sourdough", "fermentation", "related_to", 5);

    const activated = kg.spreadingActivation({ "porsche-911": 1 });

    expect(activated["track-day"]).toBeDefined();
    expect(activated["sourdough"]).toBeUndefined();
    expect(activated["fermentation"]).toBeUndefined();
  });
});
