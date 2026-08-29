// Semantic text vector embeddings and similarity computations.
// Embeddings encode post content, spoken transcripts, and OCR text into
// 384-dimensional unit vectors used by the recommendation engine.
//
// Dual-mode:
// 1. Pluggable Gemini text-embedding-004 API when GEMINI_API_KEY is configured.
// 2. High-speed local hash-vector embedding engine (zero dependencies, 0ms latency,
//    deterministic 384-dimensional unit vector).

import { workerEnv } from "./env";
import { mediaLogger } from "./log";

export const EMBEDDING_DIMENSION = 384;

/**
 * Computes cosine similarity between two float vectors.
 * For normalized unit vectors, this is simply the dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return Math.max(
    -1,
    Math.min(1, dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)))
  );
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 */
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

/**
 * Fast deterministic token hash mapping for 384-dimensional bag-of-words
 * and n-gram representations with term frequency and subword hashing.
 */
function localHashEmbedding(text: string): number[] {
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
    // Word hash
    let hash = 2_166_136_261;
    for (let c = 0; c < token.length; c += 1) {
      hash ^= token.codePointAt(c) ?? 0;
      hash = Math.imul(hash, 16_777_619);
    }
    const idx = Math.abs(hash) % EMBEDDING_DIMENSION;
    vector[idx] = (vector[idx] ?? 0) + weight;

    // Character 3-grams for subword similarity
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

/**
 * Generates an embedding vector for a given text.
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    return Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
  }

  // Cloud Gemini Embedding API if GEMINI_API_KEY is configured
  const apiKey = workerEnv.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
        {
          body: JSON.stringify({
            content: { parts: [{ text: text.slice(0, 2048) }] },
            model: "models/text-embedding-004",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      if (response.ok) {
        const data = (await response.json()) as {
          embedding?: { values?: number[] };
        };
        const values = data.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
          // Downsample or slice to 384d if needed, or normalize
          return normalizeVector(values.slice(0, EMBEDDING_DIMENSION));
        }
      }
    } catch (error) {
      mediaLogger.warn(
        { error: String(error) },
        "Gemini embedding fallback to local"
      );
    }
  }

  // Fast local deterministic vectorizer
  return localHashEmbedding(text);
}
