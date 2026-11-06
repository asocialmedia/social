import { Button } from "@asm/ui/shadui/button";
import type { ButtonProps } from "@asm/ui/shadui/button";

import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
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
      {loading ? <ZephLoader variant="security" className="size-5" /> : null}
      {props.children}
    </Button>
  );
}

export { LoadingButton };
