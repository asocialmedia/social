import { EngagementSession } from "@asm/media";
import { useEventListener } from "expo";
import type { VideoPlayer } from "expo-video";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import type { FeedPost } from "@/features/feed/lib/feed-types";

import { trackNetworkObservation } from "../lib/network-learning";

export function useNetworkPlayback(
  post: FeedPost | null | undefined,
  player: VideoPlayer,
  visible: boolean
) {
  const { user } = useSessionContext();
  const viewer = user?.id;
  const token = post?.networkRecommendationToken;
  const postId = post?.id;
  const state = useRef({
    buffering: false,
    duration: 0,
    failed: false,
    playing: false,
    position: 0,
  });
  const session = useRef<EngagementSession | null>(null);
  useEventListener(player, "sourceLoad", (event) => {
    state.current.duration = event.duration;
  });
  useEventListener(player, "timeUpdate", (event) => {
    state.current.position = event.currentTime;
  });
  useEventListener(player, "playingChange", (event) => {
    state.current.playing = event.isPlaying;
  });
  useEventListener(player, "statusChange", (event) => {
    state.current.buffering = event.status === "loading";
    state.current.failed = event.status === "error";
  });
  useEffect(() => {
    if (!viewer || !token || !postId) {
      return;
    }
    const owner = viewer;
    const observation = new EngagementSession(
      (event) =>
        trackNetworkObservation(
          owner,
          { networkRecommendationToken: token },
          event.eventType,
          event.durationMs
        ),
      postId
    );
    session.current = observation;
    state.current = {
      buffering: false,
      duration: 0,
      failed: false,
      playing: false,
      position: 0,
    };
    return () => {
      observation.stop();
      if (session.current === observation) {
        session.current = null;
      }
    };
  }, [viewer, token, postId]);
  useEffect(() => {
    const sample = () =>
      session.current?.sample(
        {
          ...state.current,
          foreground: AppState.currentState === "active",
          video: true,
          visible,
        },
        Date.now()
      );
    sample();
    const timer = setInterval(sample, 250);
    return () => {
      clearInterval(timer);
      session.current?.sample(
        { ...state.current, foreground: false, video: true, visible: false },
        Date.now()
      );
    };
  }, [visible]);
}
