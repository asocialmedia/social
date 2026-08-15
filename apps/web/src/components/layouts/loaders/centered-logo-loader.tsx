import asmLogo from "@assets/asm.png";
import Image from "next/image";

// The logo is 1448x1086 (4:3, wider than tall). Give the box the same aspect
// ratio instead of forcing a square so the mark fills the space naturally
// instead of shrinking into a small centered tile.
export const CenteredLogoLoader = ({ size = 56 }: { size?: number }) => (
  <output
    aria-label="Loading page"
    aria-live="polite"
    className="flex w-full items-center justify-center py-16"
  >
    <div
      className="relative"
      style={{ aspectRatio: "1448 / 1086", height: size, width: "auto" }}
    >
      <Image
        alt=""
        className="object-contain"
        fill
        priority
        sizes={`${Math.ceil(size * (1448 / 1086))}px`}
        src={asmLogo}
      />
    </div>
  </output>
);
