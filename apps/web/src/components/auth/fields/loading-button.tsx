import { Button } from "@asm/ui/shadui/button";
import type { ButtonProps } from "@asm/ui/shadui/button";

import Spinner3D from "@/components/layouts/feedback/spinner-3d";
import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import { cn } from "@/lib/utils";

interface LoadingButtonProps extends ButtonProps {
  loading: boolean;
  // "spinner" shows the brand 3D ring instead of the Zeph artwork; the post
  // editor uses it for publishing.
  indicator?: "spinner" | "zeph";
}

export default function LoadingButton({
  loading,
  disabled,
  className,
  indicator = "zeph",
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      className={cn("flex items-center gap-2", className)}
      disabled={loading || disabled}
      {...props}
    >
      {loading && indicator === "spinner" ? (
        <Spinner3D className="size-4" />
      ) : null}
      {loading && indicator === "zeph" ? (
        <ZephLoader variant="security" className="size-5" />
      ) : null}
      {props.children}
    </Button>
  );
}

export { LoadingButton };
