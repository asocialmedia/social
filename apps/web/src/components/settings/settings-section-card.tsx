import type { LucideIcon } from "lucide-react";
import type React from "react";

import { cn } from "@/lib/utils";

// The brand 3D surface. Light mode uses the same softened self-colored ring as
// .btn-3d (rgba(170,60,0,0.45)) instead of the dark-only 0.95 ring, which read
// as a hard dark shard around the orange fill on light backgrounds.
export const ORANGE_GRADIENT_CLASS =
  "orange-3d-surface bg-linear-to-b from-[#ff9500] to-[#e65500] text-white";

interface SettingsSectionHeaderProps {
  description: string;
  icon: LucideIcon;
  title: string;
}

export const SettingsSectionHeader = ({
  description,
  icon: Icon,
  title,
}: SettingsSectionHeaderProps) => (
  <div className="flex min-w-0 items-center gap-3">
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        ORANGE_GRADIENT_CLASS
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0">
      <h2 className="truncate text-base font-semibold sm:text-lg">{title}</h2>
      <p className="text-muted-foreground truncate text-sm">{description}</p>
    </div>
  </div>
);

interface SettingsCardProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const SettingsCard = ({
  children,
  className,
  id,
}: SettingsCardProps) => (
  <div
    className={cn(
      "border-border/60 rounded-2xl border bg-[hsl(var(--background))] p-5 sm:p-6",
      "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.06)]",
      "dark:border-white/10 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.04),inset_0_-2px_4px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.2)]",
      className
    )}
    id={id}
  >
    {children}
  </div>
);

// Tonal elevation for rows nested inside a SettingsCard: the same surface as
// the card plus a self-colored edge and a top-lit inner highlight, so depth
// reads without a contrasting outline or a drop shadow.
export const SETTINGS_SUBCARD_CLASS =
  "border-border/60 rounded-xl border bg-[hsl(var(--background))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.04),inset_0_-2px_4px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.2)]";

interface SettingsCardHeadingProps {
  description: string;
  icon: LucideIcon;
  title: string;
}

// The in-card section head: the same orange mark and title/description
// rhythm as SettingsSectionHeader, one step smaller so nested sections in a
// bento tile do not compete with the page header.
export const SettingsCardHeading = ({
  description,
  icon: Icon,
  title,
}: SettingsCardHeadingProps) => (
  <div className="flex min-w-0 items-center gap-2">
    <div
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
        ORANGE_GRADIENT_CLASS
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </div>
    <div className="min-w-0">
      <h3 className="truncate font-medium">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  </div>
);

// A tonal state marker. The on state keeps the brand orange via a deep
// light-mode tint / light dark-mode tint (mirroring the tag chip's hover pair)
// so the 12px label clears AA instead of ~3:1 on primary-at-10%; off is a
// quiet muted step. No saturated green, no glow.
export const SettingsStatusChip = ({
  className,
  on,
  children,
}: {
  children: React.ReactNode;
  className?: string;
  on: boolean;
}) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold",
      on
        ? "bg-primary/12 dark:bg-primary/20 text-[#7a2e00] dark:text-[#ffbe99]"
        : "bg-muted text-muted-foreground",
      className
    )}
  >
    {children}
  </span>
);
