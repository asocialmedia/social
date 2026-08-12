"use client";

import { CheckCircle2 } from "lucide-react";
import type React from "react";

interface FeedCaughtUpProps {
  note?: string;
}

const FeedCaughtUp: React.FC<FeedCaughtUpProps> = ({
  note = "You've seen everything here.",
}) => (
  <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
    <div className="relative">
      <CheckCircle2 className="size-9 text-primary" />
      <span
        aria-hidden
        className="absolute -inset-1 rounded-full bg-primary/10 blur-md"
      />
    </div>
    <p className="font-semibold">You&apos;re all caught up</p>
    <p className="text-muted-foreground text-sm">{note}</p>
  </div>
);

export default FeedCaughtUp;
