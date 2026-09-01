// Dynamic Knowledge Graph Engine for Content Discovery & Recommendation.
// Learns relationships, hierarchies, and affinities dynamically from user-created
// fleets, gusts, media features, and comments without hardcoded category tables.

// Entity and Relation types in the open Dynamic Knowledge Graph.
// Completely open-ended string predicates without any static restrictions.
export type EntityType = string;
export type RelationType = string;

export interface DynamicEntity {
  id: string; // Normalized kebab-case slug (e.g. "porsche-911", "gojo-satoru")
  name: string; // Human-readable name (e.g. "Porsche 911", "Gojo Satoru")
  type?: EntityType;
  metadata?: Record<string, unknown>;
  weight?: number; // Total observation count / significance
}

export interface DynamicEdge {
  relation: RelationType;
  source: string;
  target: string;
  weight: number;
}

export interface ActivationOptions {
  decay?: number; // Multiplier per hop (default: 0.5)
  maxDepth?: number; // Max traversal depth (default: 2)
  minWeight?: number; // Minimum edge weight to traverse (default: 0.1)
  topK?: number; // Max total related entities to return (default: 20)
}

function normalizeEntityId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export class DynamicKnowledgeGraph {
  private nodes = new Map<string, DynamicEntity>();
  // Adjacency: source -> target -> { relation, weight }
  private forward = new Map<
    string,
    Map<string, { relation: RelationType; weight: number }>
  >();
  // Reverse: target -> source -> { relation, weight }
  private reverse = new Map<
    string,
    Map<string, { relation: RelationType; weight: number }>
  >();
  private static readonly MAX_NODES = 5000;
  private static readonly MAX_EDGES_PER_NODE = 100;

  // Upserts an entity node in the graph.
  public upsertEntity(entity: DynamicEntity): DynamicEntity {
    const normalizedId = normalizeEntityId(entity.id);
    const existing = this.nodes.get(normalizedId);
    if (existing) {
      existing.weight = (existing.weight ?? 1) + 1;
      if (entity.metadata) {
        existing.metadata = { ...existing.metadata, ...entity.metadata };
      }
      if (entity.type && !existing.type) {
        existing.type = entity.type;
      }
      return existing;
    }

    if (this.nodes.size >= DynamicKnowledgeGraph.MAX_NODES) {
      // Evict least-weight node to bound growth
      let minId: string | null = null;
      let minWeight = Infinity;
      for (const [id, node] of this.nodes.entries()) {
        const w = node.weight ?? 1;
        if (w < minWeight) {
          minWeight = w;
          minId = id;
        }
      }
      if (minId) {
        this.nodes.delete(minId);
        this.forward.delete(minId);
        this.reverse.delete(minId);
      }
    }

    const created: DynamicEntity = {
      ...entity,
      id: normalizedId,
      name: entity.name,
      weight: entity.weight ?? 1,
    };
    this.nodes.set(normalizedId, created);
    return created;
  }

  // Returns an entity by its normalized slug.
  public getEntity(id: string): DynamicEntity | undefined {
    return this.nodes.get(id);
  }

  // Adds or increments a weighted relationship edge between two entities.
  public addEdge(
    source: string,
    target: string,
    relation: RelationType = "related_to",
    weight = 1
  ): void {
    const normSource = normalizeEntityId(source);
    const normTarget = normalizeEntityId(target);
    if (!normSource || !normTarget || normSource === normTarget) {
      return;
    }

    // Ensure both nodes exist
    if (!this.nodes.has(normSource)) {
      this.upsertEntity({ id: normSource, name: normSource });
    }
    if (!this.nodes.has(normTarget)) {
      this.upsertEntity({ id: normTarget, name: normTarget });
    }

    // Forward edge
    let sourceEdges = this.forward.get(normSource);
    if (!sourceEdges) {
      sourceEdges = new Map();
      this.forward.set(normSource, sourceEdges);
    }
    const existingForward = sourceEdges.get(normTarget);
    const newWeight = (existingForward?.weight ?? 0) + weight;
    // Bound edges per node
    if (
      !existingForward &&
      sourceEdges.size >= DynamicKnowledgeGraph.MAX_EDGES_PER_NODE
    ) {
      let minKey: string | null = null;
      let minW = Infinity;
      for (const [k, v] of sourceEdges.entries()) {
        if (v.weight < minW) {
          minW = v.weight;
          minKey = k;
        }
      }
      if (minKey) {
        sourceEdges.delete(minKey);
      }
    }
    sourceEdges.set(normTarget, { relation, weight: newWeight });

    // Reverse edge
    let targetReverse = this.reverse.get(normTarget);
    if (!targetReverse) {
      targetReverse = new Map();
      this.reverse.set(normTarget, targetReverse);
    }
    targetReverse.set(normSource, { relation, weight: newWeight });
  }

  public getIncomingNeighbors(
    id: string,
    options?: { limit?: number; minWeight?: number }
  ): { id: string; relation: RelationType; weight: number }[] {
    const normId = normalizeEntityId(id);
    const edges = this.reverse.get(normId);
    if (!edges || edges.size === 0) {
      return [];
    }
    const minWeight = options?.minWeight ?? 0;
    const limit = options?.limit ?? 20;
    const list: { id: string; relation: RelationType; weight: number }[] = [];
    for (const [source, edge] of edges.entries()) {
      if (edge.weight >= minWeight) {
        list.push({ id: source, relation: edge.relation, weight: edge.weight });
      }
    }
    return list.toSorted((a, b) => b.weight - a.weight).slice(0, limit);
  }

  // Records co-occurrence of entities in the same post, media asset, or eddie.
  // Dynamically strengthens edges between all pairs of entities that appear together.
  public recordCoOccurrence(entities: string[], contextWeight = 1): void {
    const clean = [
      ...new Set(entities.map((e) => normalizeEntityId(e))),
    ].filter(Boolean);
    if (clean.length < 2) {
      if (clean[0]) {
        this.upsertEntity({ id: clean[0], name: clean[0] });
      }
      return;
    }

    for (let i = 0; i < clean.length; i += 1) {
      const source = clean[i];
      if (!source) {
        continue;
      }
      this.upsertEntity({ id: source, name: source });

      for (let j = i + 1; j < clean.length; j += 1) {
        const target = clean[j];
        if (!target) {
          continue;
        }
        this.upsertEntity({ id: target, name: target });

        // Co-occurrence is symmetric
        this.addEdge(source, target, "co_occurs", contextWeight);
        this.addEdge(target, source, "co_occurs", contextWeight);
      }
    }
  }

  // Returns all directly connected neighbors of a given entity ordered by edge strength.
  public getNeighbors(
    id: string,
    options?: { limit?: number; minWeight?: number }
  ): { id: string; relation: RelationType; weight: number }[] {
    const edges = this.forward.get(id);
    if (!edges || edges.size === 0) {
      return [];
    }

    const minWeight = options?.minWeight ?? 0;
    const limit = options?.limit ?? 20;

    const list: { id: string; relation: RelationType; weight: number }[] = [];
    for (const [target, edge] of edges.entries()) {
      if (edge.weight >= minWeight) {
        list.push({ id: target, relation: edge.relation, weight: edge.weight });
      }
    }

    return list.toSorted((a, b) => b.weight - a.weight).slice(0, limit);
  }

  // Spreading Activation Algorithm:
  // Propagates energy from seed user interests across knowledge graph edges.
  // Returns an expanded activation map of semantically related entities with weights.
  public spreadingActivation(
    seeds: Record<string, number>,
    options?: ActivationOptions
  ): Record<string, number> {
    const decay = options?.decay ?? 0.5;
    const maxDepth = options?.maxDepth ?? 2;
    const minWeight = options?.minWeight ?? 0.1;
    const topK = options?.topK ?? 20;

    // Output activation map: entityId -> activation strength
    const activation: Record<string, number> = {};

    // Current frontier: entityId -> current energy
    let frontier: Record<string, number> = {};

    for (const [seedId, seedEnergy] of Object.entries(seeds)) {
      if (seedEnergy > 0) {
        activation[seedId] = (activation[seedId] ?? 0) + seedEnergy;
        frontier[seedId] = (frontier[seedId] ?? 0) + seedEnergy;
      }
    }

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const nextFrontier: Record<string, number> = {};

      for (const [sourceId, currentEnergy] of Object.entries(frontier)) {
        if (currentEnergy <= 0.01) {
          continue;
        }

        const neighbors = this.getNeighbors(sourceId, { limit: 10, minWeight });
        if (neighbors.length === 0) {
          continue;
        }

        // Compute total edge mass for proportional distribution
        const totalNeighborWeight = neighbors.reduce(
          (sum, n) => sum + n.weight,
          0
        );
        if (totalNeighborWeight <= 0) {
          continue;
        }

        for (const neighbor of neighbors) {
          // Weight share * decay * energy
          const transferred =
            (neighbor.weight / totalNeighborWeight) * currentEnergy * decay;
          if (transferred >= 0.01) {
            activation[neighbor.id] =
              (activation[neighbor.id] ?? 0) + transferred;
            nextFrontier[neighbor.id] =
              (nextFrontier[neighbor.id] ?? 0) + transferred;
          }
        }
      }

      frontier = nextFrontier;
      if (Object.keys(frontier).length === 0) {
        break;
      }
    }

    // Sort and truncate to topK entities
    const sorted = Object.entries(activation).toSorted((a, b) => b[1] - a[1]);
    const result: Record<string, number> = {};
    for (const [id, score] of sorted.slice(0, topK)) {
      result[id] = Number(score.toFixed(4));
    }
    return result;
  }

  // Returns total node count in the graph.
  public get nodeCount(): number {
    return this.nodes.size;
  }

  // Clears all nodes and edges (useful for tests).
  public clear(): void {
    this.nodes.clear();
    this.forward.clear();
    this.reverse.clear();
  }
}

// Global shared Knowledge Graph singleton
export const globalKnowledgeGraph = new DynamicKnowledgeGraph();
