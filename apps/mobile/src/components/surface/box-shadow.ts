// Splits a CSS box-shadow list into its outer and inset layers. Pure so it
// is unit-testable (the Gradient3D component draws each half on a different
// view; see gradient-3d.tsx).

// Commas inside rgba()/hsl() are not layer separators.
function splitLayers(shadows: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of shadows) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      layers.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    layers.push(current.trim());
  }
  return layers;
}

export function splitBoxShadow(shadows: string): {
  inset: string;
  outer: string;
} {
  const inset: string[] = [];
  const outer: string[] = [];
  for (const layer of splitLayers(shadows)) {
    if (/^inset\b/.test(layer)) {
      inset.push(layer);
    } else {
      outer.push(layer);
    }
  }
  return { inset: inset.join(", "), outer: outer.join(", ") };
}
