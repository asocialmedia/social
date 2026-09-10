// Aura flame tiers, shared by every aura display on the site: hollow at
// zero, filled orange while positive (darkening past 500), pastel red past
// 1k, pastel yellow past 10k, and pastel purple when negative.
export function getAuraFlameClass(aura: number): string {
  if (aura < 0) {
    return "fill-[#a78bfa] text-[#a78bfa]";
  }
  if (aura === 0) {
    return "text-orange-500";
  }
  if (aura <= 500) {
    return "fill-orange-500 text-orange-500";
  }
  if (aura <= 1000) {
    return "fill-orange-600 text-orange-600";
  }
  if (aura <= 10_000) {
    return "fill-[#f87171] text-[#f87171]";
  }
  return "fill-[#fde047] text-[#fde047]";
}
