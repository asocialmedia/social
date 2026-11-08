// oxlint-disable next/no-img-element -- ImageResponse renders native image elements.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ImageResponse } from "next/og";
import sharp from "sharp";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const illustration = await sharp(
  path.join(publicDirectory, "about/artwork/people-human.webp")
)
  .resize(580, 630, { fit: "cover" })
  .png()
  .toBuffer();
const font = await readFile(
  path.join(publicDirectory, "fonts/SofiaProSoftBold.ttf")
);
const card = new ImageResponse(
  <div
    style={{
      background: "#fff5e8",
      color: "#2c211b",
      display: "flex",
      fontFamily: "Sofia",
      height: "100%",
      width: "100%",
    }}
  >
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "46px 44px",
        width: 650,
      }}
    >
      <div style={{ display: "flex", fontSize: 30, letterSpacing: -1 }}>
        asocialmedia
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 81,
          letterSpacing: -4,
          lineHeight: 1.02,
          marginTop: 66,
        }}
      >
        <span>The internet,</span>
        <span>a little closer.</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 26,
          lineHeight: 1.35,
          marginTop: 28,
          maxWidth: 510,
        }}
      >
        Your people. Your interests. A wider world.
      </div>
      <div
        style={{
          alignSelf: "flex-start",
          background: "#f47936",
          display: "flex",
          fontSize: 21,
          marginTop: "auto",
          padding: "11px 16px",
        }}
      >
        No ads. Built in the open.
      </div>
      <div style={{ display: "flex", fontSize: 19, marginTop: 18 }}>
        asocialmedia.cc/about
      </div>
    </div>
    <img
      alt="Friends talking in a cozy illustrated living room"
      height={630}
      src={`data:image/png;base64,${illustration.toString("base64")}`}
      style={{ objectFit: "cover" }}
      width={550}
    />
  </div>,
  {
    fonts: [{ data: font, name: "Sofia", style: "normal", weight: 700 }],
    height: 630,
    width: 1200,
  }
);
await writeFile(
  path.join(publicDirectory, "about/share.png"),
  Buffer.from(await card.arrayBuffer())
);
console.log("Generated public/about/share.png (1200 × 630)");
