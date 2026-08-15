// oxlint-disable next/no-img-element
import type { CSSProperties } from "react";

import { emailConfig } from "../config";

export const bannerUrl =
  "https://zr2.asocialmedia.cc/Assets/zephyr-githubanner.jpg";

export const main: CSSProperties = {
  backgroundColor: "#ffffff",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

export const container: CSSProperties = {
  margin: "0 auto",
  maxWidth: "600px",
  padding: "24px 0 48px",
};

export const banner: CSSProperties = {
  display: "block",
  height: "auto",
  width: "100%",
};

export const heading: CSSProperties = {
  color: "#111111",
  fontSize: "22px",
  fontWeight: 700,
  margin: "24px 0 12px",
};

export const paragraph: CSSProperties = {
  color: "#444444",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

export const actionLink: CSSProperties = {
  color: "#ff9500",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  maxWidth: "100%",
  overflowWrap: "anywhere",
  textDecoration: "underline",
};

export const code: CSSProperties = {
  color: "#111111",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "30px",
  fontWeight: 700,
  letterSpacing: "6px",
  margin: "0 0 16px",
};

export const EmailBanner = () => (
  // oxlint-disable-next-line jsx-a11y/alt-text
  <img
    alt={`${emailConfig.company.name} banner`}
    height={252}
    src={bannerUrl}
    style={banner}
    width={600}
  />
);
