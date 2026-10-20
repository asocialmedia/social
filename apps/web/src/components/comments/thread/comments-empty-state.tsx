import noCommentsImage from "@assets/general/nocomments.png";
import Image from "next/image";

export function CommentsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <Image
        alt=""
        className="h-40 w-auto object-contain"
        draggable={false}
        height={1024}
        src={noCommentsImage}
        width={1536}
      />
      <p className="text-muted-foreground text-sm">No eddie yet.</p>
    </div>
  );
}
