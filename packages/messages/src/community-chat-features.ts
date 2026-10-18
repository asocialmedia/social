// Production chat requires an explicit opt-in while release validation is pending.
export function communityChatFeatureEnabled(
  value?: string,
  environment?: string
): boolean {
  if (value !== undefined) {
    return value === "true";
  }
  return environment === "development" || environment === "test";
}
