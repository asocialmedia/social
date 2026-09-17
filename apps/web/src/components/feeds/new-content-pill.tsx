"use client";

import { ArrowUp } from "lucide-react";

import UserAvatar from "@/components/layouts/user/user-avatar";

export interface NewContentAuthor {
  avatarUrl?: string | null;
  id: string;
  username?: string | null;
}

interface NewContentPillProps {
  authors: NewContentAuthor[];
  count: number;
  noun: string;
  onClick: () => void;
}

export function NewContentPill({
  authors,
  count,
  noun,
  onClick,
}: NewContentPillProps) {
  if (count <= 0) {
    return null;
  }

  const visibleAuthors = authors.slice(0, 3);
  const label = `${count} new ${noun}${count === 1 ? "" : "s"}`;

  return (
    <button
      aria-label={`Show ${label}`}
      className="rail-3d-btn pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="flex -space-x-2">
        {visibleAuthors.map((author) => (
          <UserAvatar
            avatarUrl={author.avatarUrl}
            className="h-6 w-6 rounded-full border-2 border-[hsl(var(--background-alt))]"
            key={author.id}
            seed={author.id}
          />
        ))}
      </span>
      <span>{label}</span>
      <ArrowUp aria-hidden="true" className="size-4" />
    </button>
  );
}
