import type { ReactNode } from "react";

export default function CommunitySidebarSectionHeading({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-2 flex h-10 min-w-0 shrink-0 items-center justify-between gap-2 px-3">
      <h2 className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-xs font-semibold">
        {children}
      </h2>
      {action}
    </div>
  );
}
