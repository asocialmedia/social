export function classifierConfig(env: Record<string, string | undefined>) {
  const token = env.CLASSIFIER_API_TOKEN;
  if (!token || token.length < 32) {
    throw new Error("CLASSIFIER_API_TOKEN must contain at least 32 characters");
  }
  const integer = (key: string, fallback: number, maximum: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${key} must be an integer from 1 to ${maximum}`);
    }
    return value;
  };
  return {
    modelPath:
      env.CLASSIFIER_MODEL_PATH ??
      new URL("../model.onnx", import.meta.url).pathname,
    port: integer("PORT", 3014, 65_535),
    queueLimit: integer("CLASSIFIER_QUEUE_LIMIT", 8, 16),
    requestTimeoutMs: integer("CLASSIFIER_REQUEST_TIMEOUT_MS", 10_000, 30_000),
    threads: integer("CLASSIFIER_THREADS", 1, 2),
    token,
  };
}
