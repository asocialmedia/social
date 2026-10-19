import { createHash } from "node:crypto";

export function analysisStageComplete(
  metadata: unknown,
  stage: string,
  model?: string
): boolean {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("analysisStages" in metadata)
  ) {
    return false;
  }
  const stages = metadata.analysisStages;
  if (!stages || typeof stages !== "object" || !(stage in stages)) {
    return false;
  }
  const value: unknown = Reflect.get(stages, stage);
  return Boolean(
    value &&
    typeof value === "object" &&
    "status" in value &&
    (!model || ("model" in value && value.model === model)) &&
    ["completed", "silent", "no_audio", "skipped"].includes(
      String(value.status)
    )
  );
}

export function transcriptionComplete(metadata: unknown): boolean {
  if (analysisStageComplete(metadata, "transcription")) {
    return true;
  }
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("transcription" in metadata)
  ) {
    return false;
  }
  const { transcription } = metadata;
  return Boolean(
    transcription &&
    typeof transcription === "object" &&
    "status" in transcription &&
    ["completed", "silent", "no_audio", "skipped"].includes(
      String(transcription.status)
    )
  );
}

export function classificationFingerprint(
  ocr: string | null | undefined,
  transcript: string | null | undefined
): string {
  return createHash("sha256")
    .update(JSON.stringify([ocr ?? "", transcript ?? ""]))
    .digest("hex");
}

export function mediaEmbeddingComplete(
  metadata: unknown,
  model: string,
  ocr: string | null | undefined,
  transcript: string | null | undefined
): boolean {
  if (
    !analysisStageComplete(metadata, "mediaEmbedding", model) ||
    !metadata ||
    typeof metadata !== "object" ||
    !("analysisStages" in metadata)
  ) {
    return false;
  }
  const stages = metadata.analysisStages;
  if (!stages || typeof stages !== "object" || !("mediaEmbedding" in stages)) {
    return false;
  }
  const cached = stages.mediaEmbedding;
  return Boolean(
    cached &&
    typeof cached === "object" &&
    "fingerprint" in cached &&
    cached.fingerprint === classificationFingerprint(ocr, transcript)
  );
}

export function transcriptionRetryEligible(
  metadata: unknown,
  now = Date.now()
): boolean {
  if (!metadata || typeof metadata !== "object") {
    return true;
  }
  const stages =
    "analysisStages" in metadata &&
    metadata.analysisStages &&
    typeof metadata.analysisStages === "object"
      ? (metadata.analysisStages as Record<string, unknown>)
      : null;
  const stage =
    (stages?.transcription && typeof stages.transcription === "object"
      ? (stages.transcription as Record<string, unknown>)
      : null) ??
    ("transcription" in metadata &&
    metadata.transcription &&
    typeof metadata.transcription === "object"
      ? (metadata.transcription as Record<string, unknown>)
      : null);
  if (!stage) {
    return true;
  }
  if ("status" in stage && stage.status === "skipped") {
    return false;
  }
  if (
    "attempts" in stage &&
    typeof stage.attempts === "number" &&
    stage.attempts >= 3
  ) {
    return false;
  }
  const attemptedAt =
    "attemptedAt" in stage && typeof stage.attemptedAt === "string"
      ? Date.parse(stage.attemptedAt)
      : Number.NaN;
  return (
    !Number.isFinite(attemptedAt) || now - attemptedAt >= 6 * 60 * 60 * 1000
  );
}
