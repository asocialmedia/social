import asmLogo from "@assets/asm.png";
import type { StaticImageData } from "next/image";
import Image from "next/image";
import type { ReactNode } from "react";

interface StatusScreenProps {
  action?: ReactNode;
  description: string;
  image?: StaticImageData | string;
  logo?: boolean;
  minHeight?: string;
  title: string;
}

export const StatusScreen = ({
  action,
  description,
  image,
  logo = true,
  minHeight = "min-h-screen",
  title,
}: StatusScreenProps) => (
  <div
    className={`flex w-full ${minHeight} bg-background flex-col items-center justify-center gap-6 p-4 text-center`}
  >
    {image ? <StatusImage image={image} /> : null}
    {!image && logo ? <Logo /> : null}
    <div className="space-y-2 text-center">
      <h1 className="text-foreground text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
    </div>
    {action ? <div className="flex justify-center">{action}</div> : null}
  </div>
);

const StatusImage = ({ image }: { image: StaticImageData | string }) => (
  <Image
    alt=""
    className="size-52 object-contain"
    draggable={false}
    height={1199}
    src={image}
    width={1312}
  />
);

const Logo = () => (
  <div className="relative h-16 w-16">
    <Image alt="" className="object-contain" fill sizes="64px" src={asmLogo} />
  </div>
);
