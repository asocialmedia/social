import { Button } from "@asm/ui/shadui/button";
import type { ButtonProps } from "@asm/ui/shadui/button";
import { Loader2 } from "lucide-react";

import Spinner3D from "@/components/layouts/feedback/spinner-3d";
import { cn } from "@/lib/utils";

interface LoadingButtonProps extends ButtonProps {
  loading: boolean;
  indicator?: "spinner" | "icon";
}

export default function LoadingButton({
  loading,
  disabled,
  className,
  indicator = "icon",
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
      {loading && indicator === "icon" ? (
        <Loader2 className="size-5 animate-spin" />
      ) : null}
      {props.children}
    </Button>
  );
}

export { LoadingButton };
