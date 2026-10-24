import { ClassifierError } from "./error";

export class InferenceQueue {
  private active = false;
  private readonly waiting: (() => void)[] = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.active) {
      if (this.waiting.length >= this.limit) {
        throw new ClassifierError("capacity_unavailable", 503);
      }
      const pending = Promise.withResolvers<undefined>();
      const resume = () => pending.resolve();
      const abort = () => {
        const index = this.waiting.indexOf(resume);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        pending.reject(signal.reason);
      };
      this.waiting.push(resume);
      signal.addEventListener("abort", abort, { once: true });
      try {
        await pending.promise;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    } else {
      this.active = true;
    }
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      const resumeNext = this.waiting.shift();
      if (resumeNext) {
        resumeNext();
      } else {
        this.active = false;
      }
    }
  }

  status() {
    return {
      active: Number(this.active),
      limit: this.limit,
      waiting: this.waiting.length,
    };
  }
}
