import { EXIT_DURATION, normalizeDuration, resolveAutopilot } from "./internal";
import type { ToastOptions, ToastPosition, ToastState } from "./types";

// A toast as held by the store: the caller's options plus the bookkeeping the
// view needs. Mirrors the records upstream builds in `buildToastRecord`.
export interface ToastRecord extends ToastOptions {
  autoCollapseDelayMs?: number;
  autoExpandDelayMs?: number;
  duration: number | null;
  exiting: boolean;
  id: string;
  // `instanceId` distinguishes a toast from a later toast that reuses the same
  // caller-supplied `id`, so an in-flight exit timer cannot remove the
  // replacement. Upstream keys its exit timers on `${id}:${instanceId}`.
  instanceId: string;
  position: ToastPosition;
  // Whether `position` came from the caller rather than the toaster default.
  // Upstream resolves placement at raise time too, but it calls `mountToaster`
  // at module scope so the default is always in place first. On native the
  // toaster is a component that mounts later, so a toast raised before it can
  // inherit the store's built-in `top-right` default. This flag lets the
  // mounting toaster re-home exactly those records when its `position` prop
  // arrives, without disturbing a toast the caller placed explicitly.
  pinnedPosition: boolean;
  state: ToastState;
}

export type ToastListener = (toasts: ToastRecord[]) => void;

let idCounter = 0;
const generateId = (): string =>
  `${(idCounter += 1)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class ToastStore {
  // Default toaster configuration, set by `configureToaster` and merged under
  // every caller's options exactly like upstream's `store.options`.
  options: Partial<ToastOptions> | undefined;
  position: ToastPosition = "top-right";
  toasts: ToastRecord[] = [];

  private listeners = new Set<ToastListener>();

  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    // Iterating a `Set` while a listener unsubscribes is well-defined: an entry
    // removed before it is reached is simply skipped, so a listener cannot be
    // visited twice or miss the emit it was registered for.
    for (const listener of this.listeners) {
      listener(this.toasts);
    }
  }

  update(updater: (toasts: ToastRecord[]) => ToastRecord[]): void {
    this.toasts = updater(this.toasts);
    this.emit();
  }
}

export const store = new ToastStore();

// Sets the default placement for toasts raised from now on, and re-homes any
// record that never chose a placement of its own. The re-tag is what makes a
// toast raised before the toaster mounted land correctly: upstream avoids this
// by calling `mountToaster` at module scope, so its default is always set
// before the first toast exists. Here the toaster is a component, so the
// store's built-in `top-right` can still be in effect when an early toast is
// raised. Records carrying an explicit `position` are left alone.
export const setDefaultPosition = (position: ToastPosition): void => {
  if (position === store.position) {
    return;
  }
  store.position = position;
  if (store.toasts.some((record) => !record.pinnedPosition)) {
    store.update((all) =>
      all.map((record) =>
        record.pinnedPosition ? record : { ...record, position }
      )
    );
  }
};

const isTimedDuration = (value: number | null): value is number =>
  value !== null && value > 0;

// Upstream `mergeOptions`: toaster defaults under the caller's options, with
// `styles` merged one level deep so a caller can override a single slot.
const mergeOptions = (options: ToastOptions): ToastOptions => ({
  ...store.options,
  ...options,
  styles: { ...store.options?.styles, ...options.styles },
});

// Placement carried over from a record being replaced, so an in-place update
// or a re-show of the same id keeps both the position and whether that position
// was the caller's to choose.
interface InheritedPosition {
  pinned: boolean;
  position: ToastPosition;
}

const buildToastRecord = (
  merged: ToastOptions,
  id: string,
  inherited: InheritedPosition | undefined
): ToastRecord => {
  const duration = normalizeDuration(merged.duration);
  return {
    ...merged,
    // `state` is injected by `toast.success` and friends; the literal type
    // carries it so the record is complete without a cast at the call site.
    ...resolveAutopilot(merged, duration),
    duration,
    exiting: false,
    id,
    instanceId: generateId(),
    pinnedPosition: merged.position !== undefined || inherited?.pinned === true,
    position: merged.position ?? inherited?.position ?? store.position,
    state: merged.state ?? "success",
  };
};

const inheritedFrom = (record: ToastRecord): InheritedPosition => ({
  pinned: record.pinnedPosition,
  position: record.position,
});

export const createToast = (
  options: ToastOptions,
  state?: ToastState
): string => {
  const merged = mergeOptions(state ? { ...options, state } : options);
  const id = merged.id ?? generateId();
  const existing = store.toasts.find((item) => item.id === id && !item.exiting);
  const next = buildToastRecord(
    merged,
    id,
    existing ? inheritedFrom(existing) : undefined
  );
  if (existing) {
    store.update((all) => all.map((item) => (item.id === id ? next : item)));
  } else {
    store.update((all) => [...all.filter((item) => item.id !== id), next]);
  }
  return id;
};

export const updateToast = (id: string, options: ToastOptions): void => {
  const existing = store.toasts.find((item) => item.id === id);
  if (!existing) {
    return;
  }
  const merged = mergeOptions({ ...options, id });
  const next = buildToastRecord(merged, id, inheritedFrom(existing));
  store.update((all) => all.map((item) => (item.id === id ? next : item)));
};

const timeoutKey = (item: ToastRecord): string =>
  `${item.id}:${item.instanceId}`;

const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Marks a record as exiting, then removes it once the exit animation window
// closes. The timer is keyed by `id:instanceId` so re-showing the same id
// mid-exit does not get removed by the previous toast's timer.
export const dismissToast = (id: string): void => {
  const existing = store.toasts.find((item) => item.id === id);
  if (!existing || existing.exiting) {
    return;
  }
  const key = timeoutKey(existing);
  store.update((all) =>
    all.map((item) => (item.id === id ? { ...item, exiting: true } : item))
  );
  const previous = exitTimers.get(key);
  if (previous !== null) {
    clearTimeout(previous);
  }
  const timer = setTimeout(() => {
    exitTimers.delete(key);
    store.update((all) =>
      all.filter(
        (item) =>
          !(item.id === existing.id && item.instanceId === existing.instanceId)
      )
    );
  }, EXIT_DURATION);
  exitTimers.set(key, timer);
};

export { isTimedDuration, timeoutKey };
