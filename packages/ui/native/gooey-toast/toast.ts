import { createToast, dismissToast, store, updateToast } from "./store";
import type {
  ToastOptions,
  ToastPosition,
  ToastPromiseOptions,
  ToasterHandle,
  ToasterOptions,
  ToastState,
} from "./types";

// Port of the `toast` object and toaster helpers exported by
// gooey-toast@0.2.2 `dist/toast.js`.

// Upstream lazily constructs a singleton `ToasterManager` on first use and
// keeps it in `singletonManager`. The native port keeps the same shape: the
// React `<GooeyToaster>` registers itself as the active renderer, and this
// module holds the handle so `configureToaster` / `unmountToaster` behave the
// same way for callers that never touch the component directly.
let activeHandle: ToasterHandle | null = null;

export const registerToaster = (handle: ToasterHandle | null): void => {
  activeHandle = handle;
};

const noopHandle: ToasterHandle = {
  unmount: () => {
    // Nothing to tear down without a mounted toaster.
  },
  update: () => {
    // Nothing to push without a mounted toaster.
  },
};

const ensureManager = (): ToasterHandle => activeHandle ?? noopHandle;

export const createToaster = (options: ToasterOptions = {}): ToasterHandle => {
  store.position = options.position ?? store.position;
  if (options.options !== undefined) {
    store.options = options.options;
  }
  // Emit so an already-mounted toaster re-renders with the new configuration.
  store.update((all) => [...all]);
  return {
    unmount: () => {
      if (activeHandle) {
        activeHandle.unmount();
        activeHandle = null;
      }
    },
    update: (next: ToasterOptions) => {
      createToaster(next);
    },
  };
};

export const mountToaster = createToaster;

export const configureToaster = (options: ToasterOptions = {}): void => {
  ensureManager();
  createToaster(options);
};

export const unmountToaster = (): void => {
  if (!activeHandle) {
    return;
  }
  activeHandle.unmount();
  activeHandle = null;
};

const showToast = (opts: ToastOptions, state?: ToastState): string =>
  // Upstream returns a fresh id when there is no DOM. Native always has a
  // renderer, so the id is real either way.
  createToast(state ? { ...opts, state } : opts);

const resolvePromiseOptions = <T>(
  value: ToastOptions | ((payload: T) => ToastOptions),
  payload: T
): ToastOptions => (typeof value === "function" ? value(payload) : value);

const settle = async <T>(
  pending: Promise<T>,
  opts: ToastPromiseOptions<T>,
  id: string
): Promise<void> => {
  try {
    const data = await pending;
    if (opts.action) {
      // Upstream stops at the action state: the caller decides what happens
      // next, so the toast is not advanced to success.
      updateToast(id, {
        ...resolvePromiseOptions(opts.action, data),
        id,
        state: "action",
      });
      return;
    }
    const success = resolvePromiseOptions(opts.success, data);
    updateToast(id, { ...success, id, state: "success" });
  } catch (error: unknown) {
    const failure = resolvePromiseOptions(opts.error, error);
    updateToast(id, { ...failure, id, state: "error" });
  }
};

export const toast = {
  // Upstream: `action(opts)` shows a toast in the `action` state, the one a
  // caller advances to from `promise({ action })` when it wants to own what
  // happens next.
  action: (opts: ToastOptions): string => showToast(opts, "action"),

  // Upstream: `clear(position?)` empties the store, optionally per position.
  clear: (position?: ToastPosition): void => {
    if (position) {
      store.update((all) => all.filter((item) => item.position !== position));
      return;
    }
    store.update(() => []);
  },

  dismiss: (id: string): void => {
    dismissToast(id);
  },

  error: (opts: ToastOptions): string => showToast(opts, "error"),

  info: (opts: ToastOptions): string => showToast(opts, "info"),

  promise: <T>(
    promise: Promise<T> | (() => Promise<T>),
    opts: ToastPromiseOptions<T>
  ): Promise<T> => {
    const id = createToast({
      ...opts.loading,
      // A loading toast must not time out on its own; upstream pins it to a
      // null duration so it survives until the promise settles.
      duration: null,
      position: opts.position,
      state: "loading",
    });

    const pending = typeof promise === "function" ? promise() : promise;
    void settle(pending, opts, id);
    return pending;
  },

  show: (opts: ToastOptions): string => showToast(opts),

  success: (opts: ToastOptions): string => showToast(opts, "success"),

  warning: (opts: ToastOptions): string => showToast(opts, "warning"),
};

export const gooeyToast = toast;
