import type * as React from "react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const Input = ({
  className,
  type,
  ref,
  ...props
}: ComponentProps<"input"> & {
  ref?: React.Ref<HTMLInputElement | null>;
}) => (
  <input
    className={cn(
      "premium-input w-full file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    type={type}
    {...props}
  />
);
Input.displayName = "Input";

export { Input };
