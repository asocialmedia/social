// Sizes describe decoded pixels, not CSS points. Both clients and the proxy
// use this order so a missing rung never accidentally selects a huge source.
export const IMAGE_DELIVERY_WIDTHS = {
  lg: 1200,
  md: 800,
  sm: 640,
  thumb: 320,
} as const;

export function imageVariantForWidth(
  pixelWidth: number,
  sourceWidth?: number | null
): string {
  const target = Math.max(1, pixelWidth);
  if (sourceWidth && sourceWidth < target && sourceWidth <= 4096) {
    return "orig-img-webp.webp";
  }
  for (const kind of ["thumb", "sm", "md", "lg"] as const) {
    const width = IMAGE_DELIVERY_WIDTHS[kind];
    if (width >= target) {
      return `${kind}-webp.webp`;
    }
  }
  return "orig-img-webp.webp";
}

export function acceptsAvif(accept: string | null): boolean {
  return (accept ?? "").split(",").some((entry) => {
    const [mime, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) =>
      parameter.trim().startsWith("q=")
    );
    return (
      mime === "image/avif" && (!quality || Number(quality.trim().slice(2)) > 0)
    );
  });
}

export function selectImageDerivative<
  T extends { kind: string; variant: string; sizeBytes?: number | null },
>(
  derivatives: readonly T[],
  kind: string,
  variant: string,
  avif: boolean
): T | undefined {
  if (!(kind in IMAGE_DELIVERY_WIDTHS) && kind !== "orig-img") {
    return derivatives.find(
      (entry) => entry.kind === kind && entry.variant === variant
    );
  }
  const widths: Record<string, number> = {
    ...IMAGE_DELIVERY_WIDTHS,
    "orig-img": 10_000,
  };
  const candidates = derivatives.filter(
    (entry) =>
      entry.kind in widths &&
      (entry.variant === variant ||
        (avif && variant === "webp" && entry.variant === "avif"))
  );
  if (
    kind === "orig-img" &&
    !candidates.some((entry) => entry.kind === "orig-img")
  ) {
    return undefined;
  }
  const target = widths[kind] ?? Infinity;
  let selectedKind: string | undefined;
  let distance = Infinity;
  for (const entry of candidates) {
    // Prefer the next larger rung to preserve resolution. If none covers it,
    // use the largest available derivative before fetching the source.
    const width = widths[entry.kind] ?? 0;
    let score = 1_000_000 - width;
    if (width === target) {
      score = 0;
    } else if (width > target) {
      score = width - target;
    }
    if (score < distance || selectedKind === undefined) {
      selectedKind = entry.kind;
      distance = score;
    }
  }
  const sameSize = candidates.filter((entry) => entry.kind === selectedKind);
  const fallback = sameSize.find((entry) => entry.variant === variant);
  const modern = sameSize.find((entry) => entry.variant === "avif");
  return modern &&
    (!fallback ||
      (typeof modern.sizeBytes === "number" &&
        typeof fallback.sizeBytes === "number" &&
        modern.sizeBytes < fallback.sizeBytes))
    ? modern
    : (fallback ?? modern);
}
