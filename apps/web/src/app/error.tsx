"use client";

import { clientLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import { useEffect } from "react";

import { StatusScreen } from "@/components/layouts/status-screen";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLog.error("Uncaught error:", error);
    if (error.digest) {
      clientLog.error("Error digest:", error.digest);
    }
  }, [error]);

  return (
    <StatusScreen
      action={
        <Button onClick={reset} variant="premium">
          Try Again
        </Button>
      }
      description="An unexpected error occurred. Please try again."
      image={errorImage}
      title="Something went wrong"
    />
  );
}
