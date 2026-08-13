"use client";

import notFoundImage from "@assets/general/notfound.png";
import Image from "next/image";
import type React from "react";

interface EmptyFeedStateProps {
  action?: React.ReactNode;
  description: string;
  title: string;
}

const EmptyFeedState: React.FC<EmptyFeedStateProps> = ({
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
    <Image
      alt=""
      className="size-52 object-contain"
      draggable={false}
      height={1145}
      src={notFoundImage}
      width={1374}
    />
    <div className="w-52 space-y-1.5">
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
    {action ? <div className="mt-1">{action}</div> : null}
  </div>
);

export default EmptyFeedState;
