interface MediaActivity {
  active: boolean | undefined;
  feedActive: boolean;
  focused: boolean;
  foreground: boolean;
  inViewport: boolean;
  viewportRequired: boolean;
}

// Retained feed rows pause native animations without removing their content.
export function isMediaActivityVisible(activity: MediaActivity): boolean {
  return (
    activity.foreground &&
    activity.feedActive &&
    activity.focused &&
    (activity.active === undefined
      ? !activity.viewportRequired || activity.inViewport
      : activity.active && activity.inViewport)
  );
}
