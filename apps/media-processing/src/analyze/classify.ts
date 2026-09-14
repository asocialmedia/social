// Dynamic Multimodal Entity Classifier & Knowledge Graph Ingestion.
// Extracts open-ended entities, proper nouns, and relationships dynamically from
// visual media (Gemini Multimodal Vision), OCR scene text, and speech transcripts.
// Feeds the Dynamic Knowledge Graph without any hardcoded category dictionaries.

import { globalKnowledgeGraph, redis } from "@asm/db";

import { workerEnv } from "../env";
import { mediaLogger, withSpan } from "../log";

export { SEMANTIC_CLASSIFICATION_VERSION } from "./semantic-version";

interface TermStatistics {
  documentFrequency: number;
}

// Learns corpus-specific term importance while this worker processes media.
// This deliberately has no language dictionary: terms that appear everywhere
// lose weight over time, while rare terms and entities remain discoverable.
const TERM_STATISTICS_LIMIT = 50_000;
const MAX_DOCUMENT_TERMS = 512;
const TERM_DOCUMENT_COUNT_KEY = "recommendation:media-terms:v1:documents";
const TERM_FREQUENCY_KEY = "recommendation:media-terms:v1:frequency";
const TERM_RECENCY_KEY = "recommendation:media-terms:v1:recency";
const termStatistics = new Map<string, TermStatistics>();
let observedDocumentCount = 0;

interface CorpusStatistics {
  documentCount: number;
  documentFrequency: Map<string, number>;
}

function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9-_]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-#@]+|[-]+$/g, "");
}

function observeTerms(terms: string[]): void {
  const uniqueTerms = new Set(terms);
  observedDocumentCount += 1;

  for (const term of uniqueTerms) {
    const current = termStatistics.get(term);
    termStatistics.set(term, {
      documentFrequency: (current?.documentFrequency ?? 0) + 1,
    });
  }

  while (termStatistics.size > TERM_STATISTICS_LIMIT) {
    const oldest = termStatistics.keys().next().value;
    if (!oldest) {
      break;
    }
    termStatistics.delete(oldest);
  }
}

function getLocalCorpusStatistics(terms: string[]): CorpusStatistics {
  observeTerms(terms);
  return {
    documentCount: observedDocumentCount,
    documentFrequency: new Map(
      [...termStatistics].map(([term, stats]) => [
        term,
        stats.documentFrequency,
      ])
    ),
  };
}

const UPDATE_TERM_STATISTICS_SCRIPT = `
  local document_count = redis.call("INCR", KEYS[1])
  local limit = tonumber(ARGV[1])

  for index = 2, #ARGV do
    local term = ARGV[index]
    redis.call("HINCRBY", KEYS[2], term, 1)
    redis.call("ZADD", KEYS[3], document_count, term)
  end

  local overflow = redis.call("ZCARD", KEYS[3]) - limit
  if overflow > 0 then
    local stale_terms = redis.call("ZRANGE", KEYS[3], 0, overflow - 1)
    for _, term in ipairs(stale_terms) do
      redis.call("HDEL", KEYS[2], term)
      redis.call("ZREM", KEYS[3], term)
    end
  end

  return document_count
`;

async function getSharedCorpusStatistics(
  terms: string[]
): Promise<CorpusStatistics> {
  const uniqueTerms = [...new Set(terms)].slice(0, MAX_DOCUMENT_TERMS);
  if (uniqueTerms.length === 0) {
    return {
      documentCount: observedDocumentCount,
      documentFrequency: new Map(),
    };
  }

  try {
    const documentCount = Number(
      await redis.eval(
        UPDATE_TERM_STATISTICS_SCRIPT,
        3,
        TERM_DOCUMENT_COUNT_KEY,
        TERM_FREQUENCY_KEY,
        TERM_RECENCY_KEY,
        TERM_STATISTICS_LIMIT,
        ...uniqueTerms
      )
    );
    const frequencies = await redis.hmget(TERM_FREQUENCY_KEY, ...uniqueTerms);
    return {
      documentCount: Number.isFinite(documentCount)
        ? documentCount
        : observedDocumentCount,
      documentFrequency: new Map(
        uniqueTerms.map((term, index) => [
          term,
          Number(frequencies[index] ?? 0),
        ])
      ),
    };
  } catch (error) {
    mediaLogger.warn(
      { error: String(error) },
      "shared term statistics unavailable; using local fallback"
    );
    return getLocalCorpusStatistics(terms);
  }
}

function calculateTermSalience(
  term: string,
  frequency: number,
  corpus: CorpusStatistics
): number {
  const documentFrequency = corpus.documentFrequency.get(term) ?? 0;
  const inverseDocumentFrequency = Math.log(
    (corpus.documentCount + 2) / (documentFrequency + 1)
  );
  const lengthWeight = 1 + Math.log2(Math.min(term.length, 24)) / 4;
  const repetitionWeight = 1 + Math.log1p(frequency);
  return (
    Math.max(0.1, inverseDocumentFrequency) * lengthWeight * repetitionWeight
  );
}

// Normalizes a list of strings into clean, unique, lowercase kebab-case tags.
export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const clean = normalizeTag(raw);
    if (clean.length >= 2 && clean.length <= 32) {
      seen.add(clean);
    }
  }
  return [...seen].slice(0, 20);
}

// Dynamically extracts entity tags and concepts from text without any hardcoded dictionary.
function extractTextTopicsWithCorpus(
  combinedText: string,
  corpus?: CorpusStatistics
): string[] {
  if (!combinedText || combinedText.trim().length === 0) {
    return [];
  }

  const matchedTags = new Map<string, number>();
  const addCandidate = (raw: string, score: number): void => {
    const tag = normalizeTag(raw);
    if (tag.length >= 2 && tag.length <= 32) {
      matchedTags.set(tag, Math.max(matchedTags.get(tag) ?? 0, score));
    }
  };

  // 1. Dynamic hashtag extraction (#astrophotography, #vintagetypewriter, #leicam6)
  const hashtagMatches = combinedText.matchAll(/#(?<tag>[a-zA-Z0-9_-]{2,32})/g);
  for (const match of hashtagMatches) {
    const tag = match.groups?.tag;
    if (tag) {
      addCandidate(tag.replaceAll("_", "-"), Number.POSITIVE_INFINITY);
    }
  }

  // 2. Dynamic multi-word proper nouns & entities (e.g. "Porsche 911 GT3", "Mount Rainier", "Leica M6", "Gojo Satoru")
  const properNounMatches = combinedText.matchAll(
    /\b(?<entity>[A-Z][a-zA-Z0-9]+(?:\s+[A-Z0-9][a-zA-Z0-9]+)*)\b/g
  );
  for (const match of properNounMatches) {
    const term = match.groups?.entity?.trim();
    if (term) {
      const precedingText = combinedText.slice(0, match.index ?? 0);
      const isSentenceInitialSingleWord =
        !/\s/.test(term) &&
        (precedingText.length === 0 || /[.!?]\s*$/.test(precedingText));
      if (!isSentenceInitialSingleWord || /\s|\d/.test(term)) {
        addCandidate(term.replaceAll(/\s+/g, "-"), Number.POSITIVE_INFINITY);
      }
    }
  }

  // 3. Dynamic alphanumeric model & spec codes (e.g. "GT3-RS", "RX-7", "RTX-4090", "K8s")
  const modelMatches = combinedText.matchAll(
    /\b(?<code>[A-Za-z]{1,4}-[0-9]{1,5}[A-Za-z0-9]*|[0-9]{3,4}[A-Za-z]{1,4})\b/g
  );
  for (const match of modelMatches) {
    const code = match.groups?.code;
    if (code) {
      addCandidate(code, Number.POSITIVE_INFINITY);
    }
  }

  // 4. Dynamic salient term and phrase extraction. The worker learns inverse
  // document frequency from the media corpus instead of deleting a fixed list
  // of English words. Explicit entities above always outrank ordinary terms.
  const sourceWords = combinedText.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  const words = sourceWords.map((word) => word.toLowerCase());
  const lexicalWords = words.filter(
    (word) => word.length >= 4 && !/^\d+$/.test(word)
  );
  const corpusStatistics = corpus ?? getLocalCorpusStatistics(lexicalWords);

  const frequencies = new Map<string, number>();
  for (const word of lexicalWords) {
    frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    addCandidate(
      word,
      calculateTermSalience(word, frequencies.get(word) ?? 1, corpusStatistics)
    );
  }

  for (let i = 0; i < words.length - 1; i += 1) {
    const word = words[i];
    const nextWord = words[i + 1];
    const sourceWord = sourceWords[i];
    const nextSourceWord = sourceWords[i + 1];
    if (!word || !nextWord || !sourceWord || !nextSourceWord) {
      continue;
    }

    const isStructuredPhrase =
      (word.length >= 4 && nextWord.length >= 4) ||
      /[A-Z0-9]/.test(sourceWord) ||
      /[A-Z0-9]/.test(nextSourceWord) ||
      (word.length >= 4 &&
        nextWord.length === 3 &&
        calculateTermSalience(
          nextWord,
          frequencies.get(nextWord) ?? 1,
          corpusStatistics
        ) > 1.4);
    if (isStructuredPhrase && word.length >= 3 && nextWord.length >= 3) {
      const phrase = `${word}-${nextWord}`;
      const phraseScore =
        calculateTermSalience(
          word,
          frequencies.get(word) ?? 1,
          corpusStatistics
        ) +
        calculateTermSalience(
          nextWord,
          frequencies.get(nextWord) ?? 1,
          corpusStatistics
        );
      addCandidate(phrase, phraseScore * 1.15);
    }
  }

  return [...matchedTags.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, 20);
}

export function extractTextTopics(combinedText: string): string[] {
  return extractTextTopicsWithCorpus(combinedText);
}

export async function extractTextTopicsWithSharedStatistics(
  combinedText: string
): Promise<string[]> {
  if (!combinedText || combinedText.trim().length === 0) {
    return [];
  }

  const words = combinedText.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  const lexicalWords = words
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word));
  const corpus = await getSharedCorpusStatistics(lexicalWords);
  return extractTextTopicsWithCorpus(combinedText, corpus);
}

// Multimodal visual entity and scene classifier powered by Google Gemini Vision.
// Inspects pixel rasters for open-ended deep entity recognition without category restrictions.
async function classifyRasterWithVision(
  imagePath: string,
  mediaId: string
): Promise<{ semantics?: Record<string, unknown>; tags: string[] }> {
  const apiKey = workerEnv.GEMINI_API_KEY;
  if (!apiKey) {
    return { tags: [] };
  }

  try {
    const file = Bun.file(imagePath);
    if (!(await file.exists())) {
      return { tags: [] };
    }

    const { size } = file;
    // Skip tiny or oversized files (>8MB) to keep latency tight
    if (size < 100 || size > 8 * 1024 * 1024) {
      return { tags: [] };
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mime = file.type || "image/jpeg";

    const model =
      workerEnv.GEMINI_TRANSCRIBE_MODEL || "gemini-flash-lite-latest";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const prompt =
      "Analyze this social media image/frame and extract deep hierarchical taxonomy entities for an open-ended recommendation graph.\n" +
      "You are NOT limited to any predefined list of categories. Dynamically discover and identify whatever is present in the image:\n" +
      "- domain: Any macro domain (e.g. automotive, anime, nature, aviation, horology, woodworking, astronomy, architecture, fashion, coffee, sports, tech, etc.)\n" +
      "- category: The specific category or sub-genre (e.g. jdm_sports_car, deep_sky_nebula, brutalist_architecture, specialty_espresso, mechanical_watch, shonen_anime, etc.)\n" +
      "- entities: Specific names, models, species, series, characters, locations, tools, or brands (e.g. 'Porsche 911 GT3', 'Matterhorn', 'Gojo Satoru', 'James Webb Space Telescope', 'La Marzocco', 'Rolex Submariner')\n" +
      "- setting: The physical setting or environment (e.g. racetrack, mountain_pass, coffee_shop, server_room, neon_street)\n" +
      "- aesthetic: Visual style, vibe, mood, and photo technique (e.g. cinematic, cyberpunk, minimalist, 90s_retro, macro_photo, dark_moody, vibrant_sunset)\n" +
      "Output valid JSON only matching this schema:\n" +
      '{"domain":"string","category":"string","entities":["string"],"setting":"string","aesthetic":["string"],"vibe":"string"}';

    const response = await fetch(url, {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64,
                  mimeType: mime,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return { tags: [] };
    }

    const data = (await response.json()) as {
      candidates?: {
        content?: {
          parts?: { text?: string }[];
        };
      }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { tags: [] };
    }

    const parsed = JSON.parse(text) as {
      aesthetic?: string[];
      category?: string;
      domain?: string;
      entities?: string[];
      vibe?: string;
    };

    const extracted: string[] = [];
    if (parsed.domain) {
      extracted.push(parsed.domain);
    }
    if (parsed.category) {
      extracted.push(parsed.category);
    }
    if (Array.isArray(parsed.entities)) {
      extracted.push(...parsed.entities);
    }
    if (Array.isArray(parsed.aesthetic)) {
      extracted.push(...parsed.aesthetic);
    }
    if (parsed.vibe) {
      extracted.push(parsed.vibe);
    }

    return {
      semantics: parsed,
      tags: sanitizeTags(extracted),
    };
  } catch (error) {
    mediaLogger.debug(
      { error: String(error), mediaId },
      "gemini vision classification skipped"
    );
    return { tags: [] };
  }
}

export interface MediaClassificationResult {
  semantics?: Record<string, unknown>;
  tags: string[];
}

// Primary semantic classification for media assets.
// Combines multimodal vision analysis, OCR text, and speech transcripts into rich topic tags.
export function classifyMediaConcepts(input: {
  imagePath?: string | null;
  mediaId: string;
  ocrText?: string | null;
  transcript?: string | null;
}): Promise<MediaClassificationResult> {
  return withSpan(
    "job.media-classify",
    async () => {
      if (!workerEnv.CLASSIFY_ENABLED) {
        return { tags: [] };
      }

      const tags = new Set<string>();
      let semantics: Record<string, unknown> | undefined;

      // 1. Multimodal visual entity classification from image raster or video keyframe
      if (input.imagePath) {
        const { semantics: visionSemantics, tags: visionTags } =
          await classifyRasterWithVision(input.imagePath, input.mediaId);
        for (const t of visionTags) {
          tags.add(t);
        }
        semantics = visionSemantics;
      }

      // 2. Dynamic text-based semantic classification from transcript and OCR
      const textToAnalyze = [input.transcript, input.ocrText]
        .filter(Boolean)
        .join(" ");
      const textTopics =
        await extractTextTopicsWithSharedStatistics(textToAnalyze);
      for (const t of textTopics) {
        tags.add(t);
      }

      const result = sanitizeTags([...tags]);
      if (result.length > 0) {
        // Record all co-occurring entities in the Dynamic Knowledge Graph
        globalKnowledgeGraph.recordCoOccurrence(result);

        mediaLogger.info(
          { mediaId: input.mediaId, tags: result },
          "semantic entities ingested into dynamic knowledge graph"
        );
      }
      return { semantics, tags: result };
    },
    { "media.id": input.mediaId }
  );
}
