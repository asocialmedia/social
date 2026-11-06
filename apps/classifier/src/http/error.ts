export class ClassifierError extends Error {
  readonly code: "invalid_image" | "image_too_large" | "capacity_unavailable";
  readonly status: number;
  constructor(code: ClassifierError["code"], status: number) {
    super(code);
    this.name = "ClassifierError";
    this.code = code;
    this.status = status;
  }
}
