"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// The Network panels' one section shell. It exists because the icon column was
// drifting: the shared heading renders a 28px mark while the rows beneath it
// used 36px marks at a different inset, so every panel stepped in and out of
// alignment. Here the heading and the rows share one 36px mark on one axis, and
// the row bodies are bare (no nested cards) so depth comes from the surface, not
// from stacking boxes.
export function SettingsPanelSection({
  children,
  count,
  description,
  icon: Icon,
  id,
  title,
}: {
  children: ReactNode;
  count?: string;
  description: string;
  icon: LucideIcon;
  id: string;
  title: string;
}) {
  return (
    <section className="surface-3d space-y-4 rounded-2xl! p-5 sm:p-6" id={id}>
      <header className="flex min-w-0 items-center gap-3 pl-3">
        <span className="orange-3d-surface flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-b from-[#ff9500] to-[#e65500] text-white">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {count ? (
          <span className="chip-3d text-muted-foreground shrink-0 rounded-full! px-2.5 py-1 text-xs font-medium tabular-nums">
            {count}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
