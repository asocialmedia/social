// Content provenance (C2PA) contracts and AI-generation heuristics. This
// module stays pure like the rest of @asm/media: it classifies an already-
// parsed C2PA manifest store and knows nothing about the native reader that
// produces it. Both the worker (scan stage) and the web app import from here.

// IPTC NewsCodes digitalSourceType URIs that indicate machine-generated
// content. The "trained" variants mean a learned model produced (or is part
// of) the asset; the others cover non-learning algorithmic synthesis, which
// platforms still owe their users an AI label for.
export const SYNTHETIC_DIGITAL_SOURCE_TYPES = [
  "trainedAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
  "algorithmicMedia",
  "algorithmicConfigurator",
  "dataDrivenMedia",
  "virtualRecording",
] as const;

// Substring matchers (lowercased) against claim_generator /
// claim_generator_info.name / action softwareAgent values. Deliberately broad:
// a false positive costs an extra evidence entry, a miss hides a synthetic
// post. Extend as new generators ship.
export const KNOWN_AI_GENERATORS = [
  "dall-e",
  "dalle",
  "openai",
  "chatgpt",
  "gpt-image",
  "adobe firefly",
  "firefly generative",
  "midjourney",
  "stable diffusion",
  "stablediffusion",
  "comfyui",
  "automatic1111",
  "invokeai",
  "black forest labs",
  "flux.",
  "imagen",
  "gemini",
  "sora",
  "veo",
  "runway",
  "leonardo.ai",
  "ideogram",
  "bing image creator",
  "copilot designer",
  "canva magic",
  "nightcafe",
  "craiyon",
  "recraft",
  "krea",
  "luma",
  "pika",
  "kling",
  "hailuo",
  "minimax",
  "hunyuan",
  "seedream",
  "grok",
] as const;

// Free-text signals scanned inside structured assertion data only (never
// captions or thumbnails). OpenAI's manifests, for example, carry a
// stds.schema-org.CustomMetadata assertion labelled "AI Generated".
const AI_ASSERTION_PATTERNS = [/ai[-_ ]?generated/i, /generative\s+ai/i];

export interface AiEvidence {
  /** What kind of signal fired. */
  kind: "digitalSourceType" | "generator" | "assertion";
  /** Where it came from: action name, assertion label, or generator field. */
  source: string;
  detail: string;
}

export interface AiProvenanceVerdict {
  aiGenerated: boolean;
  c2paPresent: boolean;
  evidence: AiEvidence[];
  generators: string[];
}

/** Persisted on Media.aiProvenance alongside the boolean flag. */
export interface MediaAiProvenance extends AiProvenanceVerdict {
  detectedAt: string;
  /** True when our own signed manifest was embedded into the published copy. */
  stamped: boolean;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Extracts every action from a manifest's assertions. Actions live inside the
 * `c2pa.actions` assertion's data array; older writers occasionally nest them
 * differently, so anything labelled "*.actions" is treated as a candidate.
 */
function collectActions(assertions: unknown[]): UnknownRecord[] {
  const actions: UnknownRecord[] = [];
  for (const raw of assertions) {
    const assertion = asRecord(raw);
    if (!assertion) {
      continue;
    }
    const label = asString(assertion.label);
    if (!label || !label.toLowerCase().endsWith(".actions")) {
      continue;
    }
    const data = asRecord(assertion.data);
    const list = data?.actions;
    if (Array.isArray(list)) {
      for (const action of list) {
        const record = asRecord(action);
        if (record) {
          actions.push(record);
        }
      }
    }
  }
  return actions;
}

function classifyDigitalSourceType(value: string): AiEvidence["kind"] | null {
  const matches = SYNTHETIC_DIGITAL_SOURCE_TYPES.some((type) =>
    value.includes(type)
  );
  return matches ? "digitalSourceType" : null;
}

function classifyGeneratorText(value: string): string | null {
  const lowered = value.toLowerCase();
  return KNOWN_AI_GENERATORS.find((needle) => lowered.includes(needle)) ?? null;
}

/**
 * Classifies a C2PA manifest store (the JSON returned by Reader.json()) for
 * AI-generation signals. Tolerates both snake_case and camelCase shapes and
 * scans every manifest in the store, because a re-saved asset keeps its
 * original generator manifest as an ingredient.
 */
export function detectAiFromManifestStore(
  manifestStore: unknown
): AiProvenanceVerdict {
  const evidence: AiEvidence[] = [];
  const generators = new Set<string>();
  const store = asRecord(manifestStore);
  const manifests =
    store && typeof store.manifests === "object" && store.manifests !== null
      ? Object.values(store.manifests as Record<string, unknown>)
      : [];

  for (const raw of manifests) {
    const manifest = asRecord(raw);
    if (!manifest) {
      continue;
    }

    // Generator identity: claim_generator string and its info array.
    const claimGenerator = asString(manifest.claim_generator);
    if (claimGenerator) {
      const needle = classifyGeneratorText(claimGenerator);
      if (needle) {
        generators.add(claimGenerator);
        evidence.push({
          detail: `claim_generator "${claimGenerator}"`,
          kind: "generator",
          source: needle,
        });
      }
    }
    const claimInfo = manifest.claim_generator_info;
    if (Array.isArray(claimInfo)) {
      for (const rawInfo of claimInfo) {
        const info = asRecord(rawInfo);
        const name = asString(info?.name);
        if (!name) {
          continue;
        }
        const needle = classifyGeneratorText(name);
        if (needle) {
          generators.add(name);
          evidence.push({
            detail: `claim_generator_info "${name}"`,
            kind: "generator",
            source: needle,
          });
        }
      }
    }

    // Actions: per-action digitalSourceType is the strongest standard signal.
    const assertions = Array.isArray(manifest.assertions)
      ? manifest.assertions
      : [];
    for (const action of collectActions(assertions)) {
      const actionName = asString(action.action) ?? "unknown-action";
      const dst = asString(action.digitalSourceType);
      if (dst && classifyDigitalSourceType(dst) === "digitalSourceType") {
        evidence.push({
          detail: `${actionName} declared ${dst}`,
          kind: "digitalSourceType",
          source: dst,
        });
      }
      const softwareAgent = asString(action.softwareAgent);
      if (softwareAgent) {
        const needle = classifyGeneratorText(softwareAgent);
        if (needle) {
          generators.add(softwareAgent);
          evidence.push({
            detail: `${actionName} softwareAgent "${softwareAgent}"`,
            kind: "generator",
            source: needle,
          });
        }
      }
    }

    // Structured assertion payloads: scan their data for explicit labels.
    for (const rawAssertion of assertions) {
      const assertion = asRecord(rawAssertion);
      const label = asString(assertion?.label);
      if (!label || label.toLowerCase().endsWith(".actions")) {
        continue;
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(assertion?.data ?? null);
      } catch {
        continue;
      }
      if (!serialized) {
        continue;
      }
      const pattern = AI_ASSERTION_PATTERNS.find((regex) =>
        regex.test(serialized)
      );
      if (pattern) {
        evidence.push({
          detail: `assertion ${label} matches ${String(pattern)}`,
          kind: "assertion",
          source: label,
        });
      }
    }
  }

  return {
    aiGenerated: evidence.length > 0,
    c2paPresent: manifests.length > 0,
    evidence,
    generators: [...generators].toSorted(),
  };
}

// Reverse-DNS label for the platform provenance assertion added to every
// stampable asset. Ingredient chain preserves any upstream Firefly/DALL-E
// manifests; this label identifies *our* assertion inside the store.
export const PLATFORM_PROVENANCE_LABEL = "cc.asocialmedia.provenance";

export interface PlatformProvenance {
  platform: "asocialmedia.cc";
  mediaId: string;
  hashedUploaderId: string | null;
  uploaderDisplayName: string | null;
  uploaderUsername: string | null;
  pipelineVersion: string;
  encoderVersion: string;
  stampedAt: string;
}

/** MIME types we can embed a signed C2PA manifest into at publish time. */
const STAMPABLE_MIME_PREFIXES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/tiff",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "audio/mp4",
  "audio/mpeg",
  "audio/webm",
  "audio/ogg",
];

export function isStampableForC2Pa(mime: string): boolean {
  const normalized = mime.toLowerCase();
  return STAMPABLE_MIME_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}
