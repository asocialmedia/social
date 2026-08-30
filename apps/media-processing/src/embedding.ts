// Semantic text vector embeddings and similarity computations.
// Embeddings encode post content, spoken transcripts, and OCR text into
// 384-dimensional unit vectors used by the recommendation engine.
//
// Dual-mode:
// 1. Pluggable Gemini embedding API (configurable via GEMINI_EMBEDDING_MODEL)
//    when GEMINI_API_KEY is configured.
// 2. High-speed local hash-vector embedding engine (zero dependencies, 0ms latency,
//    deterministic 384-dimensional unit vector).

import { workerEnv } from "./env";
import { mediaLogger } from "./log";

export const EMBEDDING_DIMENSION = 384;

// Computes cosine similarity between two float vectors.
// For normalized unit vectors, this is simply the dot product.
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

// Fast deterministic token hash mapping for 384-dimensional bag-of-words
// and n-gram representations with term frequency and subword hashing.
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

// Generates an embedding vector for a given text.
export async function generateTextEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    return Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
  }

  // The whole workflow is switchable: when embedding is disabled the local
  // hash embedder still runs so rankings keep a same-space signal.
  if (!workerEnv.EMBEDDING_ENABLED) {
    return localHashEmbedding(text);
  }

  // Cloud Gemini Embedding API if GEMINI_API_KEY is configured
  const apiKey = workerEnv.GEMINI_API_KEY;
  const modelName = workerEnv.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
  if (apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent`,
        {
          // AbortSignal timeout keeps a stalled API call from holding an
          // analyze worker slot; the catch below degrades to local hashing.
          body: JSON.stringify({
            content: { parts: [{ text: text.slice(0, 2048) }] },
            // Top-level REST field (verified against the live API): requests
            // the model's native output at our dimension instead of receiving
            // the full 3072d vector and slicing it.
            model: `models/${modelName}`,
            outputDimensionality: EMBEDDING_DIMENSION,
          }),
          headers: {
            "Content-Type": "application/json",
            // Header auth instead of a key query param keeps the credential
            // out of access logs and error URLs.
            "x-goog-api-key": apiKey,
          },
          method: "POST",
          signal: AbortSignal.timeout(workerEnv.EMBEDDING_TIMEOUT_MS),
        }
      );
      if (response.ok) {
        const data = (await response.json()) as {
          embedding?: { values?: number[] };
        };
        const values = data.embedding?.values;
        // Accept only exact-dimension vectors: a sliced or short vector would
        // normalize into a different space than every stored embedding, so a
        // mismatched response falls back to the local embedder instead.
        if (
          Array.isArray(values) &&
          values.length === EMBEDDING_DIMENSION &&
          values.every((v) => Number.isFinite(v))
        ) {
          return normalizeVector(values);
        }
        mediaLogger.warn(
          { actual: Array.isArray(values) ? values.length : "missing" },
          "Gemini embedding dimension mismatch; falling back to local"
        );
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
