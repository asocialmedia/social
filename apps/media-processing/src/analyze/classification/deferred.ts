export class ClassifierDeferredError extends Error {
  readonly retryAt: number;
  constructor() {
    super("Local classification is busy or its shared cache is unavailable");
    this.name = "ClassifierDeferredError";
    this.retryAt = Date.now() + 1000;
  }
}
