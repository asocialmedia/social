import { debugLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import Image from "next/image";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      error: null,
      hasError: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      hasError: true,
    };
  }

  // eslint-disable-next-line class-methods-use-this -- componentDidCatch is a required React lifecycle hook
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    debugLog.component("Error boundary caught error:", { error, errorInfo });
  }

  private readonly handleReset = () => {
    // eslint-disable-next-line react/no-set-state -- error boundaries reset through instance setState
    this.setState({ error: null, hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <ErrorFallback
            error={this.state.error}
            onResetErrorBoundary={this.handleReset}
          />
        )
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: Error | null;
  onResetErrorBoundary: () => void;
}

export const ErrorFallback = ({
  error,
  onResetErrorBoundary,
}: ErrorFallbackProps) => (
  <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-4 text-center">
    <Image
      alt=""
      className="size-32 object-contain"
      draggable={false}
      height={1199}
      src={errorImage}
      width={1312}
    />
    <div className="space-y-1.5">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">
        {error?.message || "An unexpected error occurred"}
      </p>
    </div>
    <Button onClick={onResetErrorBoundary}>Try again</Button>
  </div>
);
