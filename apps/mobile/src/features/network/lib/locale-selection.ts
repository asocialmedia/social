export function toggleContentLanguage(
  current: readonly string[],
  code: string
): string[] {
  if (code === "all") {
    return [];
  }
  return current.includes(code)
    ? current.filter((entry) => entry !== code)
    : [...current, code];
}

export function contentRegionLabel(
  region: string,
  label: (code: string) => string | undefined
): string {
  if (region === "auto") {
    return "Device region";
  }
  if (region === "all") {
    return "No regional preference";
  }
  return label(region) ?? region;
}
