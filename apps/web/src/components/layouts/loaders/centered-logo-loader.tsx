import asmLogo from "@assets/asm.png";
import Image from "next/image";

export const CenteredLogoLoader = ({ size = 56 }: { size?: number }) => (
  <output
    aria-label="Loading page"
    aria-live="polite"
    className="flex w-full items-center justify-center py-16"
  >
    <div
      className="relative h-[56px] w-[56px]"
      style={{ height: size, width: size }}
    >
      <Image
        alt=""
        className="object-contain"
        fill
        priority
        sizes={`${size}px`}
        src={asmLogo}
      />
    </div>
  </output>
);
