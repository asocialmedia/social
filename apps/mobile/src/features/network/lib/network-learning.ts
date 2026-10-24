import { networkRequest } from "./network-api";

interface NetworkObservation {
  networkToken: string;
  eventType: string;
  durationMs?: number;
}
let viewer = "guest";
let queue: NetworkObservation[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
export function setNetworkLearningViewer(next: string) {
  if (viewer !== next) {
    viewer = next;
    queue = [];
    clearTimeout(timer);
    timer = undefined;
  }
}
export function trackNetworkObservation(
  owner: string,
  post: { networkRecommendationToken?: string },
  eventType: string,
  durationMs?: number
) {
  if (
    owner === "guest" ||
    owner !== viewer ||
    !post.networkRecommendationToken
  ) {
    return;
  }
  queue.push({
    durationMs,
    eventType,
    networkToken: post.networkRecommendationToken,
  });
  queue = queue.slice(-50);
  if (!timer) {
    timer = setTimeout(() => {
      timer = undefined;
      void flushNetworkObservations();
    }, 2000);
  }
}
export async function flushNetworkObservations() {
  if (flushing || !queue.length || viewer === "guest") {
    return;
  }
  const owner = viewer;
  const events = queue.splice(0, 50);
  flushing = true;
  try {
    await networkRequest("/api/network/events", {
      body: JSON.stringify({ events }),
      method: "POST",
    });
  } catch {
    if (owner === viewer) {
      queue = [...events, ...queue].slice(-50);
    }
  } finally {
    flushing = false;
  }
}
