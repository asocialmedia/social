import { ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

// Replaces a post's/gust's content when an admin or the author has flagged it
// as moderated. The row stays in the database; only the rendering is swapped
// for a notice.
const ModeratedNotice: React.FC<{
  className?: string;
  kind?: "gust" | "post";
}> = ({ className, kind = "post" }) => (
  <div
    className={cn(
      "bg-muted border-border/70 flex items-center gap-3 rounded-xl border border-dashed px-4 py-5",
      className
    )}
  >
    <div className="bg-background flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
      <ShieldAlert className="text-muted-foreground size-4.5" />
    </div>
    <div className="min-w-0">
      <p className="text-foreground text-sm font-semibold">
        This {kind} has been moderated
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        It has been hidden by a moderator and is no longer visible to the
        community.
      </p>
    </div>
  </div>
);

export default ModeratedNotice;
