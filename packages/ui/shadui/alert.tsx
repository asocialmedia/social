import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../lib/utils";

const alertVariants = cva(
  "[&>svg]:text-foreground relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:top-4 [&>svg]:left-4 [&>svg+div]:translate-y-[-3px] [&>svg~*]:pl-7",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
  }
);

const Alert = ({
  className,
  variant,
  ref,
  ...props
}: (HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn(alertVariants({ variant }), className)}
    ref={ref}
    role="alert"
    {...props}
  />
);
Alert.displayName = "Alert";

const AlertTitle = ({
  children,
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & {
  ref?: React.Ref<HTMLParagraphElement | null>;
}) => (
  <h5
    className={cn("mb-1 leading-none font-medium tracking-tight", className)}
    ref={ref}
    {...props}
  >
    {children}
  </h5>
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.Ref<HTMLParagraphElement | null>;
}) => (
  <div
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    ref={ref}
    {...props}
  />
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
