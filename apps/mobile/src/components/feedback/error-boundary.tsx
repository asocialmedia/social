// Native counterpart of web's `components/misc/error-boundary.tsx`, plus the
// route-level behaviour of `app/error.tsx`.
//
// The app had no boundary of any kind, so a throw during render produced a
// redbox in development and a permanently blank screen in release, with no
// recovery affordance and nothing in telemetry. This is a class component
// because getDerivedStateFromError and componentDidCatch have no hook
// equivalent, and it logs through the same telemetry helper the rest of the app
// uses so a caught error is visible rather than swallowed.
import * as SplashScreen from "expo-splash-screen";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import errorImage from "@/assets/images/error.png";
import { logError } from "@/lib/telemetry";

import { StatusActionButton } from "./status-action-button";
import { StatusScreen } from "./status-screen";

interface Props {
  children: ReactNode;
  // Replaces the default screen, so a subtree that can offer its own recovery
  // does not have to accept the generic one.
  fallback?: (error: Error | null, retry: () => void) => ReactNode;
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // oxlint-disable-next-line class-methods-use-this -- componentDidCatch is a required React lifecycle hook and receives no meaningful `this`
  override componentDidCatch(error: Error, info: ErrorInfo) {
    // A startup failure must reveal the recovery screen rather than leave
    // the native splash covering it indefinitely.
    try {
      SplashScreen.hide();
    } catch {
      // The splash may already be gone.
    }
    logError("ui.error_boundary", error, {
      componentStack: info.componentStack ?? "",
    });
  }

  private readonly retry = () => {
    // oxlint-disable-next-line react/no-set-state -- an error boundary recovers by clearing its own state, the only mechanism React provides for this
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  override render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? (
        this.props.fallback(error, this.retry)
      ) : (
        <ErrorFallback error={error} retry={this.retry} />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, retry }: { error: Error; retry: () => void }) {
  // The message is logged, not shown. A thrown message is written for a
  // developer ("Changing numColumns on the fly is not supported...") and
  // putting it in front of a reader tells them nothing they can act on while
  // leaking internals about the surface they hit.
  logError("ui.error_shown", error);
  return (
    <StatusScreen
      action={<StatusActionButton label="Try Again" onPress={retry} />}
      description="An unexpected error occurred. Try again, and let us know if it keeps happening."
      image={errorImage}
      title="Something went wrong"
    />
  );
}
