export class AnalysisSourceDeferredError extends Error {
  readonly retryAt: number;
  constructor(retryAt: number) {
    super("Stored image sources unavailable; retrying after cooldown");
    this.name = "AnalysisSourceDeferredError";
    this.retryAt = retryAt;
  }
}
