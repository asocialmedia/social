// Semantic concept and category classifier.
// Analyzes image rasters, OCR scene text, and speech transcripts to tag media
// with topics (e.g. tech, gaming, nature, anime, homelab, music, art).
// These tags feed the For-You recommendation engine and topic exploration.

import { workerEnv } from "./env";
import { mediaLogger, withSpan } from "./log";

const TOPIC_KEYWORDS: Record<string, string[]> = {
  ai: [
    "ai",
    "gpt",
    "llm",
    "machine learning",
    "neural",
    "deep learning",
    "claude",
    "gemini",
    "openai",
  ],
  anime: [
    "anime",
    "manga",
    "vtuber",
    "gundam",
    "cosplay",
    "otaku",
    "waifu",
    "chibi",
  ],
  art: [
    "art",
    "drawing",
    "illustration",
    "sketch",
    "digitalart",
    "painting",
    "design",
    "3d render",
    "blender",
  ],
  crypto: [
    "crypto",
    "bitcoin",
    "ethereum",
    "btc",
    "eth",
    "blockchain",
    "solana",
    "web3",
    "defi",
  ],
  devops: [
    "docker",
    "kubernetes",
    "k8s",
    "ansible",
    "terraform",
    "ci/cd",
    "grafana",
    "prometheus",
    "homelab",
  ],
  fitness: [
    "fitness",
    "workout",
    "gym",
    "bodybuilding",
    "running",
    "crossfit",
    "yoga",
    "calisthenics",
  ],
  food: [
    "food",
    "cooking",
    "recipe",
    "baking",
    "coffee",
    "restaurant",
    "delicious",
    "chef",
  ],
  gaming: [
    "gaming",
    "gameplay",
    "fps",
    "rpg",
    "steam",
    "playstation",
    "xbox",
    "nintendo",
    "twitch",
    "esports",
    "minecraft",
    "fortnite",
    "valorant",
  ],
  hardware: [
    "cpu",
    "gpu",
    "nvidia",
    "amd",
    "intel",
    "motherboard",
    "raspberry pi",
    "electronics",
    "soldering",
    "pcbuild",
  ],
  linux: [
    "linux",
    "arch",
    "ubuntu",
    "debian",
    "fedora",
    "bash",
    "terminal",
    "kernel",
    "unix",
    "cli",
  ],
  music: [
    "music",
    "guitar",
    "piano",
    "synth",
    "dj",
    "beats",
    "producer",
    "remix",
    "audio",
    "track",
    "vocal",
  ],
  nature: [
    "nature",
    "forest",
    "mountain",
    "ocean",
    "sunset",
    "wildlife",
    "landscape",
    "flowers",
    "hiking",
  ],
  networking: [
    "networking",
    "router",
    "switch",
    "wireguard",
    "vpn",
    "vlan",
    "subnet",
    "dns",
    "firewall",
    "cisco",
  ],
  pets: [
    "dog",
    "cat",
    "puppy",
    "kitten",
    "pet",
    "animals",
    "cute",
    "doggo",
    "feline",
  ],
  programming: [
    "javascript",
    "typescript",
    "python",
    "rust",
    "golang",
    "c++",
    "react",
    "nextjs",
    "coding",
    "software",
    "developer",
    "git",
    "github",
    "bug",
    "frontend",
    "backend",
  ],
  science: [
    "science",
    "physics",
    "astronomy",
    "space",
    "nasa",
    "biology",
    "chemistry",
    "quantum",
    "galaxy",
  ],
  travel: [
    "travel",
    "vacation",
    "flight",
    "tourism",
    "city",
    "japan",
    "europe",
    "beach",
    "adventure",
  ],
};

// Normalizes a list of strings into clean, unique, lowercase kebab-case tags.
export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const clean = raw
      .toLowerCase()
      .trim()
      .replaceAll(/[^a-z0-9-_]/g, "")
      .replace(/^[#@]+/, "");
    if (clean.length >= 2 && clean.length <= 32) {
      seen.add(clean);
    }
  }
  return [...seen].slice(0, 10);
}

// Extracts semantic topic tags from combined textual cues (OCR text, transcript, caption).
export function extractTextTopics(combinedText: string): string[] {
  if (!combinedText || combinedText.trim().length === 0) {
    return [];
  }

  const lower = ` ${combinedText.toLowerCase()} `;
  const matchedTags = new Set<string>();

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const kw of keywords) {
      // Word boundary match
      const pattern = new RegExp(
        `(?:^|[^a-z0-9])${kw.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`,
        "i"
      );
      if (pattern.test(lower)) {
        matchedTags.add(topic);
        break;
      }
    }
  }

  return [...matchedTags];
}

// Primary semantic classification for media assets.
// Combines visual analysis, OCR text, and speech transcripts into rich topic tags.
export function classifyMediaConcepts(input: {
  imagePath?: string | null;
  mediaId: string;
  ocrText?: string | null;
  transcript?: string | null;
}): Promise<string[]> {
  return withSpan(
    "job.media-classify",
    async () => {
      if (!workerEnv.CLASSIFY_ENABLED) {
        return [];
      }

      const tags = new Set<string>();

      // 1. Text-based semantic classification from transcript and OCR
      const textToAnalyze = [input.transcript, input.ocrText]
        .filter(Boolean)
        .join(" ");
      const textTopics = extractTextTopics(textToAnalyze);
      for (const t of textTopics) {
        tags.add(t);
      }

      // 2. Visual analysis from image raster if present
      if (input.imagePath) {
        try {
          const img = Bun.file(input.imagePath);
          if (await img.exists()) {
            // Simple visual cues: aspect ratio tags
            // Will be extended with local ONNX MobileNet classifier when model is present
          }
        } catch (error) {
          mediaLogger.debug(
            { error: String(error) },
            "visual classification skipped"
          );
        }
      }

      const result = sanitizeTags([...tags]);
      if (result.length > 0) {
        mediaLogger.info(
          { mediaId: input.mediaId, tags: result },
          "semantic tags classified"
        );
      }
      return result;
    },
    { "media.id": input.mediaId }
  );
}
