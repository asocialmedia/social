import { ProtocolError } from "./contracts";
import { abortable } from "./transport";

export class BoundedReadQueue {
  private active = 0;
  private rejected = 0;
  private closed = false;
  private readonly options: {
    concurrency: number;
    maxQueued: number;
    maxWaitMs: number;
  };
  private readonly waiting: { start: () => void; cancel: () => void }[] = [];

  constructor(options: {
    concurrency: number;
    maxQueued: number;
    maxWaitMs: number;
  }) {
    this.options = options;
    if (
      Object.values(options).some(
        (value) => !Number.isSafeInteger(value) || value < 1
      )
    ) {
      throw new RangeError("Read queue limits must be positive integers");
    }
  }

  get stats() {
    return {
      active: this.active,
      queued: this.waiting.length,
      rejected: this.rejected,
    };
  }

  async run<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.closed) {
      throw new ProtocolError("cancelled", "Search queue is closed");
    }
    if (this.active < this.options.concurrency) {
      return await abortable(this.execute(read), signal);
    }
    if (this.waiting.length >= this.options.maxQueued) {
      this.rejected += 1;
      throw new ProtocolError("capacity", "Search is busy", 1);
    }
    const deferred = Promise.withResolvers<T>();
    const remove = () => {
      const index = this.waiting.indexOf(entry);
      if (index !== -1) {
        this.waiting.splice(index, 1);
      }
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      remove();
      deferred.reject(new ProtocolError("cancelled", "Search cancelled"));
    };
    const entry = {
      cancel,
      start: () => {
        remove();
        const run = async () => {
          try {
            deferred.resolve(await this.execute(read));
          } catch (error) {
            deferred.reject(error);
          }
        };
        void run();
      },
    };
    const timer = setTimeout(() => {
      remove();
      this.rejected += 1;
      deferred.reject(
        new ProtocolError("capacity", "Search queue wait exceeded", 1)
      );
    }, this.options.maxWaitMs);
    signal.addEventListener("abort", cancel, { once: true });
    this.waiting.push(entry);
    return await abortable(deferred.promise, signal);
  }

  close() {
    this.closed = true;
    while (this.waiting.length > 0) {
      this.waiting[0]?.cancel();
    }
  }

  private async execute<T>(read: () => Promise<T>) {
    this.active += 1;
    try {
      return await read();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.start();
    }
  }
}
