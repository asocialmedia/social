import footer from "@assets/mics/footer.png";
import footer1 from "@assets/mics/footer1.png";
import footer2 from "@assets/mics/footer2.png";
import footer3 from "@assets/mics/footer3.png";
import Image from "next/image";

import type { SettingsTab } from "./settings-search";

// The first meadow is wider and flatter than the other three, so each entry
// carries its own intrinsic size: next/image needs the real pair to reserve the
// right space before the file loads and to avoid a layout jump.
const ART = {
  footer: { height: 398, src: footer, width: 2164 },
  footer1: { height: 724, src: footer1, width: 2172 },
  footer2: { height: 724, src: footer2, width: 2172 },
  footer3: { height: 724, src: footer3, width: 2172 },
} as const;

// One meadow per tab, handed out in tab-strip order and then repeated, so every
// tab closes on the same world.
const TAB_ART: Record<SettingsTab, keyof typeof ART> = {
  account: "footer1",
  network: "footer1",
  personalization: "footer",
  privacy: "footer2",
  profile: "footer",
  security: "footer3",
};

// Every settings tab is a flex column, so `mt-auto` pins this art to the floor
// of the viewport on a short panel and lets it follow the content once the
// panel grows past the screen.
export default function SettingsFooterArt({
  tab,
  className = "",
}: {
  className?: string;
  tab: SettingsTab;
}) {
  const art = ART[TAB_ART[tab]];
  return (
    <div className={`shrink-0 ${className}`}>
      <Image
        alt=""
        aria-hidden
        className="block h-auto w-full object-contain"
        draggable={false}
        height={art.height}
        sizes="(max-width: 1024px) 100vw, 1024px"
        src={art.src}
        width={art.width}
      />
    </div>
  );
}
