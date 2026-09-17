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
}) => {
  // Use the image's own pixel dimensions when it is a bundled import. The box is
  // a fixed square with object-contain, so these only set the intrinsic ratio,
  // but a stale hardcoded pair would still misreport it for every other asset.
  const meta = typeof image === "string" ? null : image;
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <Image
        alt=""
        className="size-44 object-contain opacity-85"
        draggable={false}
        height={meta?.height ?? 1145}
        src={image}
        width={meta?.width ?? 1374}
      />
      <div className="w-52 space-y-1.5">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
};

export default EmptyFeedState;
