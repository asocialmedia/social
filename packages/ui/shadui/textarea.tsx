import type * as React from "react";

import { cn } from "../lib/utils";

const Textarea = ({
  className,
  ...props
}: React.ComponentProps<"textarea">) => (
  <textarea
    className={cn(
      "border-input placeholder:text-muted-foreground focus-visible:border-primary focus-visible:shadow-primary/20 focus-visible:ring-primary/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:hover:shadow-primary/10 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-all duration-200 outline-none focus-visible:shadow-lg focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm md:hover:shadow-md",
      className
    )}
    data-slot="textarea"
    {...props}
  />
);

export { Textarea };
