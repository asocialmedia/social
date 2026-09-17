import type * as React from "react";

import { cn } from "../lib/utils";

// Matches the Input primitive: the app's tactile field (.premium-input) is the
// base for every text control. It has to be the base rather than an opt-in class
// because .premium-input is declared in @layer components while the previous
// flat styling here (bg-transparent, px-3 py-2, shadow-xs, border) was in
// @layer utilities - utilities win the cascade, so a caller adding the class
// could never override it. field-sizing-content keeps the auto-grow behaviour.
const Textarea = ({
  className,
  ...props
}: React.ComponentProps<"textarea">) => (
  <textarea
    className={cn(
      "premium-input field-sizing-content min-h-16 w-full text-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    data-slot="textarea"
    {...props}
  />
);

export { Textarea };
