// oxlint-disable eslint/no-bitwise
// Semantic vector mathematics and local deterministic text embeddings for recommendations.
// Uses 384-dimensional unit vectors with cosine similarity and weighted centroids.

export const EMBEDDING_DIMENSION = 384;

// Computes cosine similarity between two float vectors (-1.0 .. 1.0).
// For unit vectors, this is simply the dot product.
export function cosineSimilarity(
  a: number[] | null | undefined,
  b: number[] | null | undefined
): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const vA = a[i] ?? 0;
    const vB = b[i] ?? 0;
    dot += vA * vB;
    nA += vA * vA;
    nB += vB * vB;
  }
  if (nA === 0 || nB === 0) {
    return 0;
  }
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(nA) * Math.sqrt(nB))));
}

// Normalizes a vector to unit length (L2 norm = 1.0).
export function normalizeVector(vector: number[]): number[] {
  let sumSq = 0;
  for (const v of vector) {
    sumSq += v * v;
  }
  const magnitude = Math.sqrt(sumSq);
  if (magnitude === 0) {
    return Array.from({ length: vector.length }).fill(0) as number[];
  }
  return vector.map((v) => v / magnitude);
}

// Computes the weighted centroid of multiple embedding vectors, normalized to a unit vector.
// This represents the user's aggregated taste vector across liked/bookmarked/amplified posts.
export function computeCentroid(
  vectors: number[][],
  weights?: number[]
): number[] {
  if (!vectors || vectors.length === 0) {
    return Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
  }

  const accumulated = Array.from({ length: EMBEDDING_DIMENSION }).fill(
    0
  ) as number[];
  let totalWeight = 0;

  for (let i = 0; i < vectors.length; i += 1) {
    const vec = vectors[i];
    if (!vec || vec.length !== EMBEDDING_DIMENSION) {
      continue;
    }
    const weight =
      weights && weights[i] !== undefined ? Math.max(0, weights[i]) : 1;
    if (weight === 0) {
      continue;
    }
    totalWeight += weight;
    for (let d = 0; d < EMBEDDING_DIMENSION; d += 1) {
      accumulated[d] = (accumulated[d] ?? 0) + (vec[d] ?? 0) * weight;
    }
  }

  if (totalWeight === 0) {
    return Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
  }

  return normalizeVector(accumulated);
}

// Fast deterministic token hash mapping for 384-dimensional bag-of-words
// and subword 3-gram representations. Zero external dependencies, < 0.2ms latency.
export function generateLocalEmbedding(text: string): number[] {
  if (!text || text.trim().length === 0) {
    return Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
  }

  const vector = Array.from({ length: EMBEDDING_DIMENSION }).fill(
    0
  ) as number[];
  const clean = text.toLowerCase().replaceAll(/[^\w\s#@]/g, " ");
  const tokens = clean.split(/\s+/).filter((t) => t.length > 1);

  if (tokens.length === 0) {
    return vector;
  }

  // Count term frequency
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  for (const [token, count] of tf) {
    const weight = 1 + Math.log(count);
    // Word 32-bit FNV-1a hash
    let hash = 2_166_136_261;
    for (let c = 0; c < token.length; c += 1) {
      hash ^= token.codePointAt(c) ?? 0;
      hash = Math.imul(hash, 16_777_619);
    }
    const idx = Math.abs(hash) % EMBEDDING_DIMENSION;
    vector[idx] = (vector[idx] ?? 0) + weight;

    // Subword character 3-grams for semantic and typo resilience
    if (token.length >= 3) {
      for (let i = 0; i <= token.length - 3; i += 1) {
        const tri = token.slice(i, i + 3);
        let triHash = 2_166_136_261;
        for (let c = 0; c < 3; c += 1) {
          triHash ^= tri.codePointAt(c) ?? 0;
          triHash = Math.imul(triHash, 16_777_619);
        }
        const triIdx = Math.abs(triHash) % EMBEDDING_DIMENSION;
        vector[triIdx] = (vector[triIdx] ?? 0) + weight * 0.3;
      }
    }
  }

  return normalizeVector(vector);
}
