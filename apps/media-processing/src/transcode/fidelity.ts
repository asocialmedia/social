// Mean local SSIM over 8x8 luminance blocks plus RGB PSNR. Both are needed:
// luminance alone misses color smearing, and whole-image error misses edges.
export function imageFidelity(
  reference: Uint8Array,
  encoded: Uint8Array,
  width: number,
  height: number
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    reference.length !== encoded.length ||
    reference.length !== width * height * 3
  ) {
    throw new Error("Fidelity comparison requires matching RGB samples");
  }
  let squaredError = 0;
  for (let index = 0; index < reference.length; index += 1) {
    squaredError += ((reference[index] ?? 0) - (encoded[index] ?? 0)) ** 2;
  }
  let similarity = 0;
  let blocks = 0;
  for (let top = 0; top < height; top += 8) {
    for (let left = 0; left < width; left += 8) {
      let sumA = 0;
      let sumB = 0;
      let squareA = 0;
      let squareB = 0;
      let product = 0;
      let count = 0;
      for (let y = top; y < Math.min(top + 8, height); y += 1) {
        for (let x = left; x < Math.min(left + 8, width); x += 1) {
          const offset = (y * width + x) * 3;
          const a =
            0.2126 * (reference[offset] ?? 0) +
            0.7152 * (reference[offset + 1] ?? 0) +
            0.0722 * (reference[offset + 2] ?? 0);
          const b =
            0.2126 * (encoded[offset] ?? 0) +
            0.7152 * (encoded[offset + 1] ?? 0) +
            0.0722 * (encoded[offset + 2] ?? 0);
          sumA += a;
          sumB += b;
          squareA += a * a;
          squareB += b * b;
          product += a * b;
          count += 1;
        }
      }
      const meanA = sumA / count;
      const meanB = sumB / count;
      const varianceA = Math.max(0, squareA / count - meanA * meanA);
      const varianceB = Math.max(0, squareB / count - meanB * meanB);
      const covariance = product / count - meanA * meanB;
      similarity +=
        ((2 * meanA * meanB + 6.5025) * (2 * covariance + 58.5225)) /
        ((meanA * meanA + meanB * meanB + 6.5025) *
          (varianceA + varianceB + 58.5225));
      blocks += 1;
    }
  }
  return {
    psnr:
      squaredError === 0
        ? Infinity
        : 10 * Math.log10(65_025 / (squaredError / reference.length)),
    ssim: similarity / blocks,
  };
}

export function passesImageFidelity(
  result: ReturnType<typeof imageFidelity>
): boolean {
  return result.ssim >= 0.99 && result.psnr >= 40;
}
