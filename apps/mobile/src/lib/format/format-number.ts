// Compact counts, ported from web's formatNumber so a metric reads the same
// on both platforms: 999 stays "999", 1_200 becomes "1.2k", and a trailing
// ".0" is trimmed so 2_000 is "2k" rather than "2.0k". Sign is preserved
// because aura can go negative.
function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

export function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}m`;
  }
  if (abs >= 1000) {
    return `${sign}${trimTrailingZero((abs / 1000).toFixed(1))}k`;
  }
  return `${sign}${abs}`;
}
