import { expect, test } from "bun:test";

import sharp from "sharp";

import { preprocessImage } from "./inference";
import { model } from "./model";

test("preprocessing produces the graph's RGB planes in 0–255 range without duplicate normalization", async () => {
  const image = await sharp({
    create: {
      background: { b: 31, g: 79, r: 173 },
      channels: 3,
      height: 2,
      width: 2,
    },
  })
    .png()
    .toBuffer();
  const pixels = await preprocessImage(image);
  const area = model.inputSize * model.inputSize;
  expect(pixels.length).toBe(area * 3);
  expect(pixels[0]).toBe(173);
  expect(pixels[area]).toBe(79);
  expect(pixels[area * 2]).toBe(31);
  expect(pixels.at(-1)).toBe(31);
});

test("unsupported and oversized decoded inputs fail closed", async () => {
  await expect(
    preprocessImage(new Uint8Array([1, 2, 3]))
  ).rejects.toMatchObject({ code: "invalid_image" });
  const image = await sharp({
    create: { background: "white", channels: 3, height: 4001, width: 4001 },
  })
    .png()
    .toBuffer();
  await expect(preprocessImage(image)).rejects.toMatchObject({
    code: "invalid_image",
  });
});
