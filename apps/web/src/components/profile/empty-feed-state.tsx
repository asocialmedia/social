"use client";

import type { LucideIcon } from "lucide-react";
import type React from "react";

interface EmptyFeedStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

const EmptyFeedState: React.FC<EmptyFeedStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    <div className="relative">
      <span
        aria-hidden
        className="absolute -inset-2.5 rounded-full bg-primary/15 blur-lg"
      />
      <div className="icon-btn-3d relative flex size-14 items-center justify-center">
        <Icon className="size-6 text-primary" />
      </div>
    </div>
    <p className="mt-1.5 font-semibold">{title}</p>
    <p className="max-w-xs text-muted-foreground text-sm">{description}</p>
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
);

export default EmptyFeedState;
