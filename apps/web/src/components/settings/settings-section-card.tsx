import type { LucideIcon } from "lucide-react";
import type React from "react";

import { cn } from "@/lib/utils";

export const ORANGE_GRADIENT_CLASS =
  "bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

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
  <div className="flex items-center gap-3">
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
