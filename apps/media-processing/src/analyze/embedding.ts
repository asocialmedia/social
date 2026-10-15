// Semantic text vector embeddings and similarity computations.
// Embeddings encode post content, spoken transcripts, and OCR text into
// 384-dimensional unit vectors used by the recommendation engine.
//
// Only verified Gemini vectors enter recommendations. Empty results stay pending.

import { workerEnv } from "../env";
import { mediaLogger } from "../log";
import {
  reserveProviderRequest,
  ProviderBudgetDeferredError,
} from "./provider-budget";

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

// Generates an embedding vector for a given text.
export async function generateTextEmbedding(
  text: string,
  mediaParts: readonly EmbeddingMediaPart[] = []
): Promise<number[]> {
  if ((!text || text.trim().length === 0) && mediaParts.length === 0) {
    return [];
  }

  if (!workerEnv.EMBEDDING_ENABLED) {
    return [];
  }

  // Cloud Gemini Embedding API if GEMINI_API_KEY is configured
  const apiKey = workerEnv.GEMINI_API_KEY;
  const modelName = workerEnv.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
  if (apiKey) {
    try {
      await reserveProviderRequest("gemini");
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent`,
        {
          // AbortSignal timeout keeps a stalled API call from holding an
          // analyze worker slot; the job can retry without losing its labels.
          body: JSON.stringify({
            content: {
              parts: [
                ...(text.trim() ? [{ text: text.slice(0, 8192) }] : []),
                ...mediaParts.slice(0, 4).map((part) => ({
                  inlineData: {
                    data: part.data.toString("base64"),
                    mimeType: part.mimeType,
                  },
                })),
              ],
            },
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
        // mismatched response stays pending instead.
        if (
          Array.isArray(values) &&
          values.length === EMBEDDING_DIMENSION &&
          values.every((v) => Number.isFinite(v)) &&
          values.some((v) => v !== 0)
        ) {
          return normalizeVector(values);
        }
        mediaLogger.warn(
          { actual: Array.isArray(values) ? values.length : "missing" },
          "Gemini embedding invalid; leaving embedding pending"
        );
      }
    } catch (error) {
      if (error instanceof ProviderBudgetDeferredError) {
        throw error;
      }
      mediaLogger.warn(
        { error: String(error) },
        "Gemini embedding unavailable; leaving embedding pending"
      );
    }
  }

  return [];
}

export interface EmbeddingMediaPart {
  mimeType: "image/jpeg" | "image/png" | "audio/mpeg" | "audio/wav";
  data: Buffer;
}

export function embeddingModelId(): string {
  return `google:${workerEnv.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2"}:384:v2`;
}
