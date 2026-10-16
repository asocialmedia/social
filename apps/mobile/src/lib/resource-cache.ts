import { BoundedProfileCache } from "@/features/profile/lib/profile-cache";

export class ResourceCache<T> extends BoundedProfileCache<T> {
  private requests = new Map<string, Promise<void>>();
  private generation = 0;

  load(key: string, loader: () => Promise<T>, force = false): Promise<void> {
    const pending = this.requests.get(key);
    if (pending) {
      return pending;
    }
    if (!force && this.isFresh(key) && !this.read(key).stale) {
      return Promise.resolve();
    }
    const { generation } = this;
    this.markStale(key);
    const request = (async () => {
      // Register the request before a loader can fail synchronously.
      await Promise.resolve();
      try {
        const data = await loader();
        if (generation === this.generation) {
          this.setData(key, data);
        }
      } catch (error) {
        if (generation === this.generation) {
          this.setError(
            key,
            error instanceof Error ? error.message : "Couldn't load this list."
          );
        }
      } finally {
        if (generation === this.generation) {
          this.requests.delete(key);
        }
      }
    })();
    this.requests.set(key, request);
    return request;
  }

  override clear(): void {
    this.generation += 1;
    this.requests.clear();
    super.clear();
  }
}
