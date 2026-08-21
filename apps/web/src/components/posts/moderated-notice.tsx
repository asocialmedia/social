import errorImage from "@assets/general/error.png";
import Image from "next/image";

import { cn } from "@/lib/utils";

// Replaces a post's/gust's content when an admin or the author has flagged it
// as moderated. The row stays in the database; only the rendering is swapped
// for a notice. Compact horizontal layout: small avatar on the left, message on
// the right, minimal height.
const ModeratedNotice: React.FC<{
  className?: string;
  kind?: "gust" | "post";
}> = ({ className, kind = "post" }) => (
  <div
    className={cn(
      "bg-muted border-border/70 flex items-center gap-3 rounded-xl border border-dashed px-4 py-2.5",
      className
    )}
  >
    <Image
      alt=""
      className="size-12 shrink-0 object-contain"
      draggable={false}
      height={48}
      sizes="48px"
      src={errorImage}
      width={48}
    />
    <div className="min-w-0">
      <p className="text-foreground text-sm leading-tight font-semibold">
        This {kind} seemed harmful
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs leading-tight">
        So it&apos;s been tucked away to keep the feed a good place. No harm
        meant, and everyone&apos;s welcome back.
      </p>
    </div>
  </div>
);

export default ModeratedNotice;
