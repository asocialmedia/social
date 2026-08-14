import notFoundImage from "@assets/general/notfound.png";
import Image from "next/image";

export default function FeedEnd() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      <Image
        alt=""
        className="h-40 w-auto object-contain"
        draggable={false}
        height={160}
        src={notFoundImage}
        style={{ aspectRatio: "1374 / 1145" }}
        width={192}
      />
      <p className="text-muted-foreground text-sm sm:text-base">
        You&apos;re all caught up!
      </p>
    </div>
  );
}
