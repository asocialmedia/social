import type { ReactNode, Ref } from "react";

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
