// Dynamic Multimodal Entity Classifier & Knowledge Graph Ingestion.
// Extracts open-ended entities, proper nouns, and relationships dynamically from
// visual media (Gemini Multimodal Vision), OCR scene text, and speech transcripts.
// Feeds the Dynamic Knowledge Graph without any hardcoded category dictionaries.

import { globalKnowledgeGraph } from "@asm/db";

import { workerEnv } from "./env";
import { mediaLogger, withSpan } from "./log";

// Common English functional and grammatical stop words to ignore when extracting salient keywords.
const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "cannot",
  "could",
  "couldn",
  "did",
  "didn",
  "do",
  "does",
  "doesn",
  "doing",
  "don",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "good",
  "had",
  "hadn",
  "has",
  "hasn",
  "have",
  "haven",
  "having",
  "he",
  "hello",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "isn",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "morning",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "shouldn",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "today",
  "tomorrow",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "wasn",
  "we",
  "were",
  "weren",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "won",
  "would",
  "wouldn",
  "yesterday",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "really",
  "something",
  "someone",
  "anyone",
  "world",
  "good",
  "morning",
  "afternoon",
  "evening",
]);

// Normalizes a list of strings into clean, unique, lowercase kebab-case tags.
export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const clean = raw
      .toLowerCase()
      .trim()
      .replaceAll(/[^a-z0-9-_]/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^[-#@]+|[-]+$/g, "");
    if (clean.length >= 2 && clean.length <= 32 && !STOP_WORDS.has(clean)) {
      seen.add(clean);
    }
  }
  return [...seen].slice(0, 20);
}

// Dynamically extracts entity tags and concepts from text without any hardcoded dictionary.
export function extractTextTopics(combinedText: string): string[] {
  if (!combinedText || combinedText.trim().length === 0) {
    return [];
  }

  const matchedTags = new Set<string>();

  // 1. Dynamic hashtag extraction (#astrophotography, #vintagetypewriter, #leicam6)
  const hashtagMatches = combinedText.matchAll(/#(?<tag>[a-zA-Z0-9_-]{2,32})/g);
  for (const match of hashtagMatches) {
    const tag = match.groups?.tag;
    if (tag) {
      matchedTags.add(tag.toLowerCase().replaceAll("_", "-"));
    }
  }

  // 2. Dynamic multi-word proper nouns & entities (e.g. "Porsche 911 GT3", "Mount Rainier", "Leica M6", "Gojo Satoru")
  const properNounMatches = combinedText.matchAll(
    /\b(?<entity>[A-Z][a-zA-Z0-9]+(?:\s+[A-Z0-9][a-zA-Z0-9]+)*)\b/g
  );
  for (const match of properNounMatches) {
    const term = match.groups?.entity?.trim();
    if (term) {
      const lower = term.toLowerCase();
      if (!STOP_WORDS.has(lower) && lower.length >= 3) {
        matchedTags.add(lower.replaceAll(/\s+/g, "-"));
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
      matchedTags.add(code.toLowerCase());
    }
  }

  // 4. Dynamic salient term & phrase extraction (meaningful terms not in stop words)
  const words = combinedText
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (
      word &&
      word.length >= 4 &&
      !STOP_WORDS.has(word) &&
      !/^\d+$/.test(word)
    ) {
      matchedTags.add(word);
    }
    // Dynamic bigram noun phrases (e.g. "golden-retriever", "shiba-inu", "wireguard-vpn")
    if (i < words.length - 1) {
      const nextWord = words[i + 1];
      if (
        word &&
        nextWord &&
        word.length >= 3 &&
        nextWord.length >= 3 &&
        !STOP_WORDS.has(word) &&
        !STOP_WORDS.has(nextWord)
      ) {
        matchedTags.add(`${word}-${nextWord}`);
      }
    }
  }

  return sanitizeTags([...matchedTags]);
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
      const textTopics = extractTextTopics(textToAnalyze);
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
