"use client";

import noSearchImage from "@assets/general/nosearch.png";
import Image from "next/image";
import type React from "react";

interface FeedCaughtUpProps {
  note?: string;
}

const FeedCaughtUp: React.FC<FeedCaughtUpProps> = ({
  note = "You've seen everything here.",
}) => (
  <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
    <Image
      alt=""
      className="h-24 w-auto object-contain"
      draggable={false}
      height={192}
      src={noSearchImage}
      width={192}
    />
    <div className="w-28 space-y-1.5">
      <p className="font-semibold">You&apos;re all caught up</p>
      <p className="text-muted-foreground text-sm">{note}</p>
    </div>
  </div>
);

export default FeedCaughtUp;
