import { Button } from "@asm/ui/shadui/button";
import type { ButtonProps } from "@asm/ui/shadui/button";
import { Skeleton } from "@asm/ui/shadui/skeleton";

import { cn } from "@/lib/utils";

interface LoadingButtonProps extends ButtonProps {
  loading: boolean;
}

export default function LoadingButton({
  loading,
  disabled,
  className,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      className={cn("flex items-center gap-2", className)}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <Skeleton className="size-5" /> : null}
      {props.children}
    </Button>
  );
}

export { LoadingButton };
