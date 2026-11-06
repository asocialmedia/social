import greetingArtwork from "@assets/general/zeph-say-hi.webp";
import Image from "next/image";

export function ConversationGreeting({
  name,
  isDen = false,
}: {
  name: string;
  isDen?: boolean;
}) {
  return (
    <div className="flex max-w-full flex-col items-center gap-3 px-6 py-5 text-center">
      <p className="text-muted-foreground max-w-full text-sm font-medium wrap-break-word">
        {isDen ? `Say hi in ${name}` : `Say hi to ${name}`}
      </p>
      <Image
        alt="Zeph waving hello"
        className="size-36 object-contain"
        draggable={false}
        height={144}
        loading="eager"
        src={greetingArtwork}
        unoptimized
        width={144}
      />
    </div>
  );
}
