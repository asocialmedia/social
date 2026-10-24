import { EngagementSession } from "@asm/media";
import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { submitRecommendationEvents } from "@/features/gusts/lib/gusts-api";
import { RecommendationQueue } from "@/features/gusts/lib/recommendation-tracker";
import { trackNetworkObservation } from "@/features/network/lib/network-learning";
import { getApiBaseUrl } from "@/lib/api-env";

import type { FeedPost } from "../lib/feed-types";
import { hasVideoAttachment } from "../lib/media-kind";

// Non-video dwell and all visible impressions; video watch time comes from playback.
export function useFeedImpressions(
  posts: FeedPost[],
  visible: { current: ReadonlySet<string> },
  active: boolean,
  viewerId?: string | null
): void {
  const postsById = useMemo(
    () => new Map(posts.map((post) => [post.id, post])),
    [posts]
  );
  const latest = useRef({ active, posts: postsById, viewerId });
  useEffect(() => {
    latest.current = { active, posts: postsById, viewerId };
  }, [active, postsById, viewerId]);
  useEffect(() => {
    if (!viewerId) {
      return;
    }
    const queue = new RecommendationQueue(async (events) =>
      submitRecommendationEvents(events, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      })
    );
    const sessions = new Map<
      string,
      { session: EngagementSession; requestId?: string }
    >();
    const sample = () => {
      const state = latest.current;
      const foreground = AppState.currentState === "active";
      const shown =
        state.active && foreground && state.viewerId
          ? visible.current
          : new Set<string>();
      for (const [id, item] of sessions) {
        if (!shown.has(id)) {
          item.session.sample(
            { foreground: false, video: false, visible: false },
            Date.now()
          );
          item.session.stop(state.active && foreground);
          sessions.delete(id);
        }
      }
      for (const id of shown) {
        const post = state.posts.get(id);
        if (!post) {
          continue;
        }
        let item = sessions.get(post.id);
        const requestId = post.recommendation?.requestId;
        if (item && item.requestId !== requestId) {
          item.session.stop();
          sessions.delete(post.id);
          item = undefined;
        }
        if (!item) {
          const video = hasVideoAttachment(post);
          item = {
            requestId,
            session: new EngagementSession((event) => {
              if (!video || event.eventType === "IMPRESSION") {
                trackNetworkObservation(
                  state.viewerId ?? "guest",
                  post,
                  event.eventType,
                  event.durationMs
                );
                if (!post.external) {
                  queue.push(
                    event.eventType,
                    post.id,
                    event.durationMs,
                    undefined,
                    requestId
                  );
                }
              }
            }),
          };
          sessions.set(post.id, item);
        }
        item.session.sample(
          { foreground, video: false, visible: true },
          Date.now()
        );
      }
    };
    const timer = setInterval(sample, 250);
    const subscription = AppState.addEventListener("change", sample);
    return () => {
      clearInterval(timer);
      subscription.remove();
      for (const item of sessions.values()) {
        item.session.stop(false);
      }
      void queue.flush();
    };
  }, [visible, viewerId]);
}
