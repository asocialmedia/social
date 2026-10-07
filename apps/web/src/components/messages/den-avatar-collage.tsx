"use client";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { denAvatarFaces } from "@/lib/messages/den-label";
import type { DenLabelMember } from "@/lib/messages/den-label";
import { cn } from "@/lib/utils";

// A den's face, as a pile of circles inside one square frame.
//
// A den has no single person, so it cannot have a single avatar. Two shapes, in
// this order: an image the den picked, drawn full-bleed like any other; or a
// collage of the members' faces, which is what a den without an image gets.
//
// The collage is always exactly `size` by `size`. That is the whole reason it
// exists: the lateral stack it replaces measured `size + step * (faces - 1)`
// wide, so it overflowed every square slot it sat in, and clipping it just
// amputated the faces sitting past the edge. A square frame with a fixed
// geometry per count cannot overflow and has nothing to clip.
//
// Geometry, in fractions of `size`. Every pair that touches does so at roughly
// half to two-thirds of a diameter - the band where an overlap reads as
// deliberate layering rather than a collision - and paint order is face order
// (later siblings paint on top), so overlaps are sequential, never noise:
//
//   2 faces: diagonal, the second lapping over the first;
//   3 faces: one on top, two on the bottom, a chain of 1 -> 2 -> 3;
//   4 faces: a 2x2 circle grid, adjacent laps only;
//   5 or more: the grid's first three cells, then a "+N" circle in the last.
//
// Each circle keeps a ring in the tile-background colour. That ring is what
// makes an overlap read as layering: without it two faces merge into one shape.
// The tile itself carries the `avatar-ring` edge, so the frame reads as one
// object rather than four images nailed together.
//
// Which faces, and in what order, is `denAvatarFaces` in `den-label.ts`. That
// decision is pure and unit-tested; this file only draws it.

export interface DenAvatarCollageProps {
  avatarMediaId?: string | null;
  className?: string;
  members: readonly (DenLabelMember & { role?: string | null })[];
  myUserId?: string;
  size?: number;
}

// One slot in the tile: a face's centre and diameter, or the count.
interface CollageSlot {
  cx: number;
  cy: number;
  d: number;
}

// The geometry, keyed by how many circles the tile holds. Fractions of `size`,
// so the same table serves the 32px thread header and the 96px details hero.
function collageSlots(count: 2 | 3 | 4): CollageSlot[] {
  if (count === 2) {
    return [
      { cx: 0.35, cy: 0.35, d: 0.7 },
      { cx: 0.65, cy: 0.65, d: 0.7 },
    ];
  }
  if (count === 3) {
    return [
      { cx: 0.5, cy: 0.3, d: 0.5 },
      { cx: 0.28, cy: 0.68, d: 0.5 },
      { cx: 0.72, cy: 0.68, d: 0.5 },
    ];
  }
  return [
    { cx: 0.25, cy: 0.25, d: 0.55 },
    { cx: 0.75, cy: 0.25, d: 0.55 },
    { cx: 0.25, cy: 0.75, d: 0.55 },
    { cx: 0.75, cy: 0.75, d: 0.55 },
  ];
}

export function DenAvatarCollage({
  avatarMediaId,
  className,
  members,
  myUserId,
  size = 44,
}: DenAvatarCollageProps) {
  // The den's own image wins. One picture is a better identity than any
  // arrangement of strangers, and the den chose it deliberately.
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

  const faces = denAvatarFaces(members, myUserId, 4);
  if (faces.length === 0) {
    // A den with nobody in it, which the create rules prevent but a
    // just-dissolved or freshly-loaded one can still render. The gradient
    // fallback inside UserAvatar is exactly the right answer here.
    return <UserAvatar className={className} seed="den" size={size} />;
  }

  // One face needs no collage: drawing a single avatar reads as a person's chat,
  // which is exactly the confusion the pile exists to prevent.
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

  // A 2px ring eats a 13px face, so the ring steps down on the small tiles. The
  // colour never changes: it is always the tile behind the faces, which is what
  // turns an overlap into a layer.
  const faceRing = size < 40 ? "ring-1" : "ring-2";
  const count = faces.length >= 4 ? 4 : (faces.length as 2 | 3);
  const slots = collageSlots(count);
  // Past four the tile stops growing faces and starts counting: the last slot is
  // the tally, so a 100-member den is still four circles and an honest number.
  //
  // Gated on the total member count (including the viewer), not on the faces:
  // `denAvatarFaces` caps at four, so with exactly four members `faces.length` is
  // also four and there is nothing to count.
  const memberCount = members.length;
  const overflow = memberCount > 4 ? memberCount - 3 : 0;

  return (
    <span
      aria-hidden
      // `flex shrink-0 items-center justify-center` keeps the box strictly square
      // and centered without the baseline strut or descender shift of `inline-block`.
      // Deliberately NO frame: no `overflow-hidden`, no rounded rect, no edge. The
      // circles are free to overflow the nominal box rather than being clipped to
      // it, so the pile reads as faces spilling out instead of pictures nailed
      // inside a tile. The box still reserves exactly `size` by `size` for layout,
      // so rows never shift; only paint may exceed it, and only by the circles'
      // own bleed.
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        className
      )}
      style={{ height: size, width: size }}
    >
      {slots.map((slot, index) => {
        const diameter = Math.round(slot.d * size);
        const left = Math.round((slot.cx - slot.d / 2) * size);
        const top = Math.round((slot.cy - slot.d / 2) * size);
        if (index === 3 && overflow > 0) {
          return (
            <span
              className="bg-muted text-muted-foreground absolute flex items-center justify-center rounded-full font-semibold tabular-nums ring-[hsl(var(--background))]"
              key="overflow"
              style={{
                fontSize: Math.max(9, Math.round(size * 0.2)),
                height: diameter,
                left,
                top,
                width: diameter,
              }}
            >
              +{overflow}
            </span>
          );
        }
        const face = faces[index];
        return (
          <span
            // Later siblings paint on top, so DOM order IS the z-order and the
            // overlaps run face 1 -> 2 -> 3 in sequence.
            //
            // `overflow-hidden` clips the square image to the circle. Without it the
            // image's corners escape the round frame and four "circles" read as four
            // overlapping squares.
            className={cn(
              "absolute overflow-hidden rounded-full ring-[hsl(var(--background))]",
              faceRing
            )}
            key={`${face.id}-${index}`}
            style={{ height: diameter, left, top, width: diameter }}
          >
            <UserAvatar
              avatarUrl={face.avatarUrl}
              seed={face.id}
              size={diameter}
            />
          </span>
        );
      })}
    </span>
  );
}
