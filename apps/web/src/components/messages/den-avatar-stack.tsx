"use client";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { denAvatarFaces } from "@/lib/messages/den-label";
import type { DenLabelMember } from "@/lib/messages/den-label";
import { cn } from "@/lib/utils";

// A den's face.
//
// A den has no single person, so it cannot have a single avatar. Two shapes, in
// this order: an image the den picked, drawn as one avatar like any other; or
// the stacked faces of the members, which is what a den without an image gets.
//
// The stack is three faces on an overlap rather than a grid, because the row it
// lives in has a fixed square and a grid of three would need three times the
// height. The count badge is the fourth case — a den with more members than
// faces — and it is an aria-hidden `+N` with the real total in the row's own
// accessible name, so a screen reader hears a number rather than a shape.
//
// Which faces, and in what order, is `denAvatarFaces` in `den-label.ts`. That
// decision is pure and unit-tested; this file only draws it.

export interface DenAvatarStackProps {
  avatarMediaId?: string | null;
  className?: string;
  members: readonly (DenLabelMember & { role?: string | null })[];
  myUserId: string;
  size?: number;
}

export function DenAvatarStack({
  avatarMediaId,
  className,
  members,
  myUserId,
  size = 44,
}: DenAvatarStackProps) {
  // The den's own image wins. One picture is a better identity than three
  // overlapping strangers, and the den chose it deliberately.
  if (avatarMediaId) {
    return (
      <UserAvatar
        avatarUrl={`/api/media/${avatarMediaId}`}
        className={className}
        seed="den"
        size={size}
      />
    );
  }

  const faces = denAvatarFaces(members, myUserId);
  if (faces.length === 0) {
    // A den with nobody else in it, which the create rules prevent but a
    // just-dissolved or freshly-loaded one can still render. The gradient
    // fallback inside UserAvatar is exactly the right answer here.
    return <UserAvatar className={className} seed="den" size={size} />;
  }

  // One face needs no stack: drawing a single avatar reads as a person's chat,
  // which is exactly the confusion the stack exists to prevent.
  if (faces.length === 1) {
    return (
      <UserAvatar
        avatarUrl={faces[0].avatarUrl}
        className={className}
        seed={faces[0].id}
        size={size}
      />
    );
  }

  // Each face is inset from the right by a share of the overlap, so the stack
  // stays inside the row's square instead of growing out of it.
  const step = Math.round(size * 0.3);
  const others = members.filter((member) => member.id !== myUserId).length;

  return (
    <span
      aria-hidden
      className={cn("relative shrink-0", className)}
      style={{ height: size, width: size + step * (faces.length - 1) }}
    >
      {faces.map((face, index) => (
        <span
          // The faces are ordered by role and join order rather than by id, so the
          // index is the only stable key here — and the whole stack is
          // aria-hidden, so nothing is lost by keying on position.
          key={`${face.id}-${index}`}
          className="absolute top-0 rounded-xl ring-2 ring-[hsl(var(--background))]"
          style={{ left: step * index }}
        >
          <UserAvatar
            avatarUrl={face.avatarUrl}
            seed={face.id}
            size={size - 4}
          />
        </span>
      ))}
      {others > faces.length ? (
        <span
          className="bg-muted text-muted-foreground absolute top-0 flex items-center rounded-xl border-2 border-[hsl(var(--background))] text-[10px] font-semibold tabular-nums"
          style={{ height: size, left: step * faces.length, width: size }}
        >
          +{others - faces.length}
        </span>
      ) : null}
    </span>
  );
}
