declare module "gifenc" {
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgba4444"; oneBitAlpha?: boolean }
  ): number[][];
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: "rgba4444"
  ): Uint8Array;
  export function GIFEncoder(): {
    writeFrame: (
      data: Uint8Array,
      width: number,
      height: number,
      options: {
        palette: number[][];
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        dispose?: number;
      }
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array<ArrayBuffer>;
  };
}
