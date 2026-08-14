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
      "premium-input file:text-foreground placeholder:text-muted-foreground w-full file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    type={type}
    {...props}
  />
);
Input.displayName = "Input";

export { Input };
