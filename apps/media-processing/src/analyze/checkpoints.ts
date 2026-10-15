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
    ["completed", "silent", "no_audio"].includes(String(value.status))
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
    ["completed", "silent", "no_audio"].includes(String(transcription.status))
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
