import { useCallback, useState } from "react";

// Keep clicks immediate while the URL catches up; back/forward adopts the resolved tab.
export function useFeedTabSelection<T extends string>(resolved: T) {
  const [selection, setSelection] = useState({ resolved, value: resolved });
  let { value } = selection;
  if (selection.resolved !== resolved) {
    value = resolved;
    setSelection({ resolved, value: resolved });
  }
  const select = useCallback(
    (next: T) => {
      setSelection({ resolved, value: next });
    },
    [resolved]
  );
  return [value, select] as const;
}
