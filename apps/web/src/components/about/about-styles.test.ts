import { expect, test } from "bun:test";

import tailwind from "@tailwindcss/postcss";
import { transform } from "lightningcss";
import postcss from "postcss";

test("About animations survive Tailwind and the strict CSS parser used by Next.js", async () => {
  const filename = `${import.meta.dir}/about.css`;
  const result = await postcss([tailwind()]).process(
    await Bun.file(filename).text(),
    { from: filename }
  );
  const parsed = transform({
    code: Buffer.from(result.css),
    errorRecovery: false,
    filename,
  });
  expect(result.warnings()).toHaveLength(0);
  expect(parsed.warnings).toHaveLength(0);
  const output = parsed.code.toString();
  for (const scene of [
    "hero-tile",
    "hero-spread",
    "features-sink",
    "networks-track",
    "principles-fill",
    "footer-signature",
  ]) {
    expect(output).toContain(`@keyframes about-${scene}`);
    expect(output).toContain(`about-${scene}`);
  }
});
