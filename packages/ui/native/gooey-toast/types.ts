import type { ReactNode } from "react";

// Mirror of gooey-toast@0.2.2 `dist/types.d.ts`, with the DOM `Node` /
// `DocumentFragment` renderables swapped for React nodes. Everything else —
// state names, position list, autopilot shape, option keys — is kept identical
// so a call written against the web wrapper keeps working here.
export type ToastState =
  | "success"
  | "loading"
  | "error"
  | "warning"
  | "info"
  | "action";

// CSS class names upstream. Kept for call-site compatibility: on native they are
// accepted and ignored rather than silently dropped, so passing `styles` does
// not need a branch at every call site.
export interface ToastStyles {
  badge?: string;
  button?: string;
  description?: string;
  title?: string;
}

export interface ToastButton {
  onClick: () => void;
  title: string;
}

export const TOAST_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type ToastPosition = (typeof TOAST_POSITIONS)[number];

// Upstream resolves renderables through `() => value` thunks and DOM nodes.
// Native keeps the thunk form and adds React elements.
export type ToastRenderableValue =
  | string
  | number
  | ReactNode
  | null
  | undefined;
export type ToastRenderable =
  | ToastRenderableValue
  | (() => ToastRenderableValue);

export interface ToastAutopilot {
  collapse?: number;
  expand?: number;
}

export interface ToastOptions {
  autopilot?: boolean | ToastAutopilot;
  button?: ToastButton;
  description?: ToastRenderable;
  duration?: number | null;
  fill?: string;
  // Upstream reads its geometry from the `--gooey-width` / `--gooey-height`
  // custom properties, which apps/web overrides in a stylesheet rather than
  // through the option bag. These two carry the same override into native so a
  // call can pin the shell's 280x48 surface. Absent means the library default.
  height?: number;
  icon?: ToastRenderable | null;
  id?: string;
  // Upstream also carries `state` at runtime (it is not part of the public
  // option type, `toast.success` injects it). Declared here so the records the
  // store holds typecheck without casts.
  position?: ToastPosition;
  roundness?: number;
  state?: ToastState;
  styles?: ToastStyles;
  timeoutIndicator?: boolean;
  title?: string;
  width?: number;
}

export interface ToastPromiseOptions<T = unknown> {
  action?: ToastOptions | ((data: T) => ToastOptions);
  error: ToastOptions | ((err: unknown) => ToastOptions);
  loading: Pick<ToastOptions, "title" | "icon">;
  position?: ToastPosition;
  success: ToastOptions | ((data: T) => ToastOptions);
}

export type ToasterOffsetValue = number | string;
export type ToasterOffsetConfig = Partial<
  Record<"top" | "right" | "bottom" | "left", ToasterOffsetValue>
>;

export interface ToasterOptions {
  offset?: ToasterOffsetValue | ToasterOffsetConfig;
  options?: Partial<ToastOptions>;
  // Upstream mounts into a `target` HTMLElement. Native has no equivalent, so
  // the port ignores it and always renders at the app root; the key is kept so
  // a shared options object still typechecks.
  position?: ToastPosition;
  target?: unknown;
}

export interface ToasterHandle {
  unmount: () => void;
  update: (options: ToasterOptions) => void;
}
