import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const MEDIA_MENU_ACTION_CLASS =
  "text-foreground hover:bg-accent/50 focus-visible:ring-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px]/5.5 font-medium outline-none focus-visible:ring-2 active:opacity-60 disabled:opacity-50";

export function MediaMenuActionContent({
  icon: Icon,
  label,
  selected = false,
}: {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full",
          selected &&
            "bg-linear-to-b from-amber-400 to-amber-600 text-white shadow-[inset_0_0_0_1px_#ffffff40,inset_0_1.5px_2px_#ffffff80,0_0_0_1px_#965a00]"
        )}
      >
        <Icon
          aria-hidden
          className={cn("size-5.5", selected && "size-4 fill-white")}
        />
      </span>
      {label}
    </>
  );
}
