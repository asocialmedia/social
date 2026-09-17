"use client";

import { Link } from "@tiptap/extension-link";
import { MarkViewContent, ReactMarkViewRenderer } from "@tiptap/react";
import type { MarkViewProps } from "@tiptap/react";

import {
  hostLabel,
  platformFromUrl,
} from "@/components/posts/embeds/link-badge";

// The bio's link mark rendered as the badge it becomes on the profile page:
// the platform logo (YouTube, GitHub, ...) or a host initial, followed by the
// editable URL text. The mark keeps the raw URL as its content, so `getText`
// still serializes the URL and `textToDoc` can rebuild the same mark - only
// the presentation changes.
function LinkBadgeMarkView({ mark }: MarkViewProps) {
  const href = typeof mark.attrs.href === "string" ? mark.attrs.href : "";
  const platform = platformFromUrl(href);
  const label = hostLabel(href);

  return (
    <span className="meta-chip meta-chip-link inline-link-badge">
      {platform ? (
        <platform.Icon className={`size-3.5 shrink-0 ${platform.className}`} />
      ) : (
        <span className="bg-muted text-muted-foreground flex size-3.5 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold">
          {(label[0] ?? "L").toUpperCase()}
        </span>
      )}
      <MarkViewContent />
    </span>
  );
}

// Extension used only where links should be visible while editing (the bio).
// StarterKit's own link is disabled there so this one owns the rendering.
export const BioLink = Link.extend({
  addMarkView() {
    return ReactMarkViewRenderer(LinkBadgeMarkView);
  },
});
