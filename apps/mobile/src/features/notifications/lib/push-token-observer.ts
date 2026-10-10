// Getting the current FCM token may emit it again; only a changed token needs registration.
export function createPushTokenObserver(
  registeredToken: () => string | null,
  onChange: () => void
): (token: unknown) => void {
  let observed: string | null = null;
  return (token) => {
    if (
      typeof token !== "string" ||
      !token ||
      token === observed ||
      token === registeredToken()
    ) {
      return;
    }
    observed = token;
    onChange();
  };
}
