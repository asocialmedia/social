import errorImage from "@assets/general/error.png";
import Image from "next/image";

import { cn } from "@/lib/utils";

// Replaces a post's/gust's content when an admin or the author has flagged it
// as moderated. The row stays in the database; only the rendering is swapped
// for a notice. Compact horizontal layout: small avatar on the left, message on
// the right, minimal height. Solid dual border: an outer border plus an inset
// hairline ring, matching the app's panel language instead of a dashed outline.
const ModeratedNotice: React.FC<{
  className?: string;
  kind?: "gust" | "post";
}> = ({ className, kind = "post" }) => (
  <div
    className={cn(
      "bg-muted border-border/60 flex items-center gap-3 rounded-xl border border-solid px-4 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.05)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_2px_rgba(255,255,255,0.04)]",
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
