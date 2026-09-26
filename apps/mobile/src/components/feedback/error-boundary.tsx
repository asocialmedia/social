// Native counterpart of web's `components/misc/error-boundary.tsx`, plus the
// route-level behaviour of `app/error.tsx`.
//
// The app had no boundary of any kind, so a throw during render produced a
// redbox in development and a permanently blank screen in release, with no
// recovery affordance and nothing in telemetry. This is a class component
// because getDerivedStateFromError and componentDidCatch have no hook
// equivalent, and it logs through the same telemetry helper the rest of the app
// uses so a caught error is visible rather than swallowed.
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import errorImage from "@/assets/images/error.png";
import { logError } from "@/lib/telemetry";

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
  return (
    <StatusScreen
      action={
        <Pressable
          accessibilityLabel="Try again"
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => [
            styles.retry,
            { opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      }
      // Web shows a generic description here. The real message is more useful
      // and is already safe to display, since it is the text a developer wrote.
      description={error.message || "An unexpected error occurred."}
      image={errorImage}
      title="Something went wrong"
    />
  );
}

const styles = StyleSheet.create({
  retry: {
    backgroundColor: "#f97316",
    borderCurve: "continuous",
    borderRadius: 9999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 15 },
});
