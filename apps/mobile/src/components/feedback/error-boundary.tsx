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
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";
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
  // The message is logged, not shown. A thrown message is written for a
  // developer ("Changing numColumns on the fly is not supported...") and
  // putting it in front of a reader tells them nothing they can act on while
  // leaking internals about the surface they hit.
  logError("ui.error_shown", error);
  return (
    <StatusScreen
      action={<TryAgainButton onPress={retry} />}
      description="An unexpected error occurred. Try again, and let us know if it keeps happening."
      image={errorImage}
      title="Something went wrong"
    />
  );
}

/**
 * Web's `.btn-3d`, which is a dual border by construction: a light inset lip
 * over a dark outer ring, on an orange gradient. React Native's boxShadow has
 * no inset, so the lip is a real border on the gradient and the ring is a
 * second view behind it, which is the same two edges rather than a flat fill.
 */
function TryAgainButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Try again"
      accessibilityRole="button"
      onPress={onPress}
      style={styles.ring}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={pressed ? ORANGE_PRESSED_GRADIENT : ORANGE_GRADIENT}
          radius={9999}
          shadows={ORANGE_BUTTON_SHADOWS}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Gradient3D>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  retry: {
    alignItems: "center",
    // The light lip, which is the inset half of the dual border.
    borderColor: "rgba(255, 255, 255, 0.3)",
    borderCurve: "continuous",
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 15,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  // The dark outer ring, one pixel proud of the gradient on every side. This
  // plus the gradient's light lip is the pair web's .btn-3d draws with an inset
  // shadow and an outer ring in a single box-shadow, which React Native cannot
  // express because its boxShadow has no inset.
  ring: {
    borderColor: "rgba(170, 60, 0, 0.95)",
    borderCurve: "continuous",
    borderRadius: 9999,
    borderWidth: 1,
    padding: 1,
  },
});
