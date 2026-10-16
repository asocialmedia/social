export async function runSignOutFlow({
  navigate,
  unregister,
  revoke,
  clear,
  complete,
}: {
  navigate: () => void;
  unregister: () => Promise<unknown>;
  revoke: () => Promise<unknown>;
  clear: () => void;
  complete: () => void;
}): Promise<void> {
  navigate();
  try {
    await unregister();
    await revoke();
  } finally {
    clear();
    complete();
  }
}
