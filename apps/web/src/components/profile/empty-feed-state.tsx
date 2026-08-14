"use client";

import notFoundImage from "@assets/general/notfound.png";
import Image from "next/image";
import type { StaticImageData } from "next/image";
import type React from "react";

interface EmptyFeedStateProps {
  action?: React.ReactNode;
  description: string;
  image?: StaticImageData | string;
  title: string;
}

const EmptyFeedState: React.FC<EmptyFeedStateProps> = ({
  title,
  description,
  action,
  image = notFoundImage,
}) => (
  <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
    <Image
      alt=""
      className="size-44 object-contain opacity-85"
      draggable={false}
      height={1145}
      src={image}
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
