"use client";

import { lazy } from "react";

const PostEditor = lazy(() => import("@/components/posts/editor/post-editor"));

export default function HomeComposer() {
  return <PostEditor />;
}
