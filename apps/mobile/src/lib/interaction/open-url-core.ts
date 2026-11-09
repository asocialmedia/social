// The React Native free half of openExternalUrl, so the failure handling is
// unit-testable on Bun.

export interface OpenUrlDependencies {
  onFailure: (url: string) => void;
  open: (url: string) => Promise<unknown>;
}

// Resolves true when the system accepted the URL. Never rejects: an empty
// target or a rejected open reports through onFailure and resolves false.
export async function openUrlSafely(
  url: string,
  dependencies: OpenUrlDependencies
): Promise<boolean> {
  const target = url.trim();
  if (!target) {
    dependencies.onFailure(url);
    return false;
  }
  try {
    await dependencies.open(target);
    return true;
  } catch {
    dependencies.onFailure(target);
    return false;
  }
}
