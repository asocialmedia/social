import type { ReactNode, Ref } from "react";
import { useState } from "react";

interface GustSlot {
  id: string | null;
  key: string;
}

export function reconcileGustSlots(
  previous: readonly GustSlot[],
  ids: readonly string[],
  pending: boolean
): GustSlot[] {
  const keys = new Map(previous.map((slot) => [slot.id, slot.key]));
  const pendingKey = keys.get(null);
  const lastPost = previous.findLast((slot) => slot.id !== null);
  const tail = lastPost ? ids.indexOf(lastPost.id ?? "") : -1;
  let arrival: string | undefined = ids[0];
  if (lastPost) {
    arrival = tail >= 0 ? ids[tail + 1] : undefined;
  }
  let adopted = false;
  const slots: GustSlot[] = ids.map((id) => {
    let key = keys.get(id);
    if (!key && id === arrival && pendingKey) {
      key = pendingKey;
      adopted = true;
    }
    return { id, key: key ?? crypto.randomUUID() };
  });
  if (pending) {
    slots.push({
      id: null,
      key: !adopted && pendingKey ? pendingKey : crypto.randomUUID(),
    });
  }
  return slots;
}

export function useGustStreamSlots(
  ids: readonly string[],
  pending: boolean,
  scope: string
) {
  const signature = JSON.stringify([scope, ids, pending]);
  const [layout, setLayout] = useState(() => ({
    scope,
    signature,
    slots: reconcileGustSlots([], ids, pending),
  }));
  if (layout.signature !== signature) {
    const next = {
      scope,
      signature,
      slots: reconcileGustSlots(
        layout.scope === scope ? layout.slots : [],
        ids,
        pending
      ),
    };
    setLayout(next);
    return next.slots;
  }
  return layout.slots;
}

export function GustStreamSlot({
  children,
  index,
  loading,
  pending = false,
  ref,
}: {
  children: ReactNode;
  index?: number;
  loading?: boolean;
  pending?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      aria-busy={pending ? loading : undefined}
      aria-label={pending ? "Loading more Gusts" : undefined}
      className="flex h-full w-full snap-start snap-always items-center justify-center py-0 sm:h-[98%] sm:py-2"
      data-index={index}
      ref={ref}
    >
      {children}
    </div>
  );
}
