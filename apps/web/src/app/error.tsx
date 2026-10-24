"use client";

import { clientLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect } from "react";

import { StatusScreen } from "@/components/layouts/feedback/status-screen";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const needsReload = Boolean(unstable_isUnrecognizedActionError(error));
  useEffect(() => {
    if (needsReload) {
      clientLog.info("A new app version requires a reload");
      return;
    }
    clientLog.error("Uncaught error:", error);
    if (error.digest) {
      clientLog.error("Error digest:", error.digest);
    }
  }, [error, needsReload]);

  return (
    <StatusScreen
      action={
        <Button
          onClick={needsReload ? () => window.location.reload() : reset}
          variant="premium"
        >
          {needsReload ? "Reload app" : "Try Again"}
        </Button>
      }
      description={
        needsReload
          ? "Reload the app to continue with the latest version."
          : "An unexpected error occurred. Please try again."
      }
      image={errorImage}
      title={needsReload ? "An update is available" : "Something went wrong"}
    />
  );
}
