// Cancellation of an upload/publish step (the caller aborted its signal).
export class AbortError extends Error {
  constructor(message = "Upload cancelled") {
    super(message);
    this.name = "AbortError";
  }
}
