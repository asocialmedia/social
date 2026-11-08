"use client";

import { Skeleton } from "@asm/ui/shadui/skeleton";
import dynamic from "next/dynamic";
import type React from "react";
import { useCallback, useEffect } from "react";

import { useComposerStore } from "@/store/composer-store";

const PostEditor = dynamic(
  () => import("@/components/posts/editor/post-editor"),
  { loading: () => <Skeleton className="h-34 w-full rounded-none" /> }
);

const FloatingPostComposer: React.FC = () => {
  const isOpen = useComposerStore((state) => state.isOpen);
  const closeComposer = useComposerStore((state) => state.closeComposer);

  const handleOverlayClick = useCallback(() => {
    closeComposer();
  }, [closeComposer]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeComposer();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeComposer]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-6 sm:pt-[8vh]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleOverlayClick}
      />

      <div className="panel-3d relative w-full max-w-2xl overflow-hidden rounded-2xl!">
        <div className="max-h-[85vh] overflow-y-auto">
          <PostEditor variant="modal" />
        </div>
      </div>
    </div>
  );
};

export default FloatingPostComposer;
