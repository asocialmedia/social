export const model = {
  bytes: 13_137_569,
  id: "OwenElliott/image-safety-classifier-xs",
  inputSize: 224,
  labels: ["NSFL", "NSFW", "SFW"],
  preprocessing: "rgb-bilinear-stretch-nchw-float32-0-255-v1",
  revision: "54f4560bd9c5ee92d45dc30418a8f8680e80de6d",
  sha256: "8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689",
} as const;

export const maxImageBytes = 4 * 1024 * 1024;

export interface Classification {
  label: (typeof model.labels)[number];
  probabilities: { NSFL: number; NSFW: number; SFW: number };
  timing: { decodeMs: number; inferenceMs: number };
}

export type Classify = (image: Uint8Array) => Promise<Classification>;
