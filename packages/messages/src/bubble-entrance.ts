import type { BubbleLaunchOrigin } from "./bubble-motion";

// Live arrivals are explicitly registered before insertion. History reads never
// register, so mounting or recycling a transcript row cannot replay an entrance.
export class BubbleEntranceRegistry {
  readonly #arrivals = new Map<
    string,
    { time: number; origin?: BubbleLaunchOrigin } | null
  >();

  register(
    messageId: string,
    now = Date.now(),
    origin?: BubbleLaunchOrigin
  ): void {
    if (this.#arrivals.has(messageId)) {
      return;
    }
    this.#arrivals.set(messageId, { origin, time: now });
    while (this.#arrivals.size > 128) {
      const oldest = this.#arrivals.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#arrivals.delete(oldest);
    }
  }

  isPending(messageId: string, now = Date.now()): boolean {
    const arrival = this.#arrivals.get(messageId);
    if (!arrival) {
      return false;
    }
    return now >= arrival.time && now - arrival.time < 2000;
  }

  getOrigin(messageId: string): BubbleLaunchOrigin | undefined {
    return this.#arrivals.get(messageId)?.origin;
  }

  consume(messageId: string): void {
    if (this.#arrivals.has(messageId)) {
      this.#arrivals.set(messageId, null);
    }
  }
}
