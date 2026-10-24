export const CLOUDFLARE_FREE_NEURON_CEILING = 9500;

export function resolveClefDailyNeurons(raw?: string | number) {
  const value = raw === undefined ? 9000 : Number(raw);
  if (!Number.isFinite(value)) {
    return 9000;
  }
  return Math.max(
    0,
    Math.min(CLOUDFLARE_FREE_NEURON_CEILING, Math.floor(value))
  );
}
