"use client";

import { useEffect } from "react";

import { useVideoCaptionsStore } from "@/lib/video-captions-store";

// Rehydrates the persisted captions preference once on mount. The store uses
// skipHydration so the SSR pass and first client render share the same
// default; without this call localStorage would never be read.
export function VideoCaptionsHydration() {
  useEffect(() => {
    void useVideoCaptionsStore.persist.rehydrate();
  }, []);

  return null;
}
