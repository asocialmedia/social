// oxlint-disable next/no-head-element, next/no-img-element, react/no-danger, jsx-a11y/control-has-associated-label
import type { CSSProperties, ReactNode } from "react";

import { emailConfig } from "../config";

// ---------------------------------------------------------------------------
// Brand type
// ---------------------------------------------------------------------------

// Sofia Pro Soft is the face the app itself uses (see packages/ui fonts). It is
// self-hosted by the web app and embedded below via @font-face, so clients that
// honour webfonts (Apple Mail, iOS, Thunderbird) render the real brand type.
// Everywhere else the stack falls back to the OS rounded face: no Google font
// is ever loaded over the network from inside an email.
export const EMAIL_FONT_STACK =
  "'SofiaProSoft', ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// One warm, coherent world: a cream canvas, a near-white card, warm near-black
// ink and the single amber accent the app uses. Values are only ever these.
export const palette = {
  accent: "#f26419",
  accentBorder: "#d9530e",
  accentDeep: "#c24708",
  body: "#474542",
  canvas: "#f2efe9",
  card: "#fdfcfa",
  faint: "#78736c",
  hairline: "#f0ede6",
  ink: "#141413",
  inkSoft: "#3d3c39",
  muted: "#6e6b65",
  store: "#141413",
} as const;

// ---------------------------------------------------------------------------
// Legacy primitives
// ---------------------------------------------------------------------------

// Kept for the templates that have not been migrated to the card design yet
// (OTP, two-factor, password reset). New templates should use the components
// below instead of these.
export const { bannerUrl } = emailConfig.assets;

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

// The brand line closes every transactional email. It is the same sentence the
// site, the manifest and the app description use, so a forwarded verification
// email carries the positioning with it.
export const brandLine: CSSProperties = {
  color: "#7b7b82",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "24px 0 0",
};

export const EmailBanner = () => (
  // oxlint-disable-next-line jsx-a11y/alt-text
  <img
    alt={`${emailConfig.company.name} banner`}
    height={252}
    loading="lazy"
    src={bannerUrl}
    style={banner}
    width={600}
  />
);

// ---------------------------------------------------------------------------
// Document shell
// ---------------------------------------------------------------------------

function fontFaces(): string {
  const { fonts } = emailConfig.assets;
  return [
    `@font-face{font-family:'SofiaProSoft';font-style:normal;font-weight:400;font-display:swap;src:url(${fonts.regular}) format('woff2')}`,
    `@font-face{font-family:'SofiaProSoft';font-style:normal;font-weight:500;font-display:swap;src:url(${fonts.medium}) format('woff2')}`,
    `@font-face{font-family:'SofiaProSoft';font-style:normal;font-weight:700;font-display:swap;src:url(${fonts.bold}) format('woff2')}`,
  ].join("");
}

function emailStyles(): string {
  return [
    fontFaces(),
    // Reset.
    "body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}",
    "table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}",
    "img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none}",
    `body{margin:0!important;padding:0!important;width:100%!important;background-color:${palette.canvas};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}`,
    // The one 3D pill, lifted from the app's own .btn-3d.
    `.btn-3d{background:#f26419;background-image:linear-gradient(180deg,#ff7e38 0%,#f26419 100%);box-shadow:inset 0 1.5px 0 rgba(255,255,255,0.38),0 3px 0 ${palette.accentDeep},0 6px 14px rgba(242,100,25,0.24)}`,
    ".btn-3d:hover{background-image:linear-gradient(180deg,#ff8847 0%,#f76b20 100%);box-shadow:inset 0 1.5px 0 rgba(255,255,255,0.45),0 4px 0 #c24708,0 8px 18px rgba(242,100,25,0.3)}",
    `.store-btn{background-color:${palette.store};color:#ffffff;border-radius:12px;padding:11px 16px;text-decoration:none;display:block;border-bottom:3px solid #000000;white-space:nowrap}`,
    ".store-btn:hover{background-color:#2b2a28}",
    ".step-link:hover span{text-decoration:underline!important}",
    // The store row is a two-cell table so the buttons never stack: cells sit
    // on one row at every width and simply shrink. Only the padding tightens.
    ".store-table{width:100%!important;table-layout:fixed!important}",
    ".store-td{width:50%!important}",
    // Responsive: condense the frame; the store row stays side by side.
    "@media screen and (max-width:520px){",
    ".outer-pad{padding:24px 12px 36px!important}",
    ".card-pad{padding:20px 20px 28px!important;border-radius:24px!important}",
    ".hero-title{font-size:21px!important}",
    ".store-btn{padding:9px 11px!important}",
    ".store-label{font-size:13px!important}",
    ".store-icon{height:22px!important}",
    "}",
  ].join("");
}

const bodyStyle: CSSProperties = {
  backgroundColor: palette.canvas,
  color: palette.ink,
  fontFamily: EMAIL_FONT_STACK,
  margin: 0,
  padding: 0,
  width: "100%",
};

const preheaderStyle: CSSProperties = {
  display: "none",
  fontSize: "1px",
  lineHeight: "1px",
  maxHeight: 0,
  maxWidth: 0,
  opacity: 0,
  overflow: "hidden",
};

interface EmailDocumentProps {
  children: ReactNode;
  preheader: string;
  title: string;
}

export const EmailDocument = ({
  children,
  preheader,
  title,
}: EmailDocumentProps) => (
  <html dir="ltr" lang="en">
    <head>
      <meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
      <meta content="width=device-width, initial-scale=1" name="viewport" />
      <meta content="light" name="color-scheme" />
      <meta content="light" name="supported-color-schemes" />
      <meta content="1" name="x-apple-disable-message-reformatting" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: emailStyles() }} />
    </head>
    <body style={bodyStyle}>
      <div style={preheaderStyle}>{preheader}</div>
      {children}
    </body>
  </html>
);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const EmailCanvas = ({ children }: { children: ReactNode }) => (
  <table
    border={0}
    cellPadding={0}
    cellSpacing={0}
    role="presentation"
    style={{ backgroundColor: palette.canvas }}
    width="100%"
  >
    <tbody>
      <tr>
        <td
          align="center"
          className="outer-pad"
          style={{ padding: "36px 16px 52px" }}
        >
          <table
            border={0}
            cellPadding={0}
            cellSpacing={0}
            role="presentation"
            style={{ maxWidth: "456px", width: "100%" }}
            width="100%"
          >
            <tbody>{children}</tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
);

export const BrandHeader = () => (
  <tr>
    <td align="center" style={{ paddingBottom: "28px" }}>
      <a
        href={emailConfig.company.website}
        style={{ display: "inline-block", textDecoration: "none" }}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={emailConfig.company.name}
          height={72}
          loading="lazy"
          src={emailConfig.assets.headerLogo}
          style={{ display: "block", height: "72px", width: "auto" }}
        />
      </a>
    </td>
  </tr>
);

export const EmailCard = ({ children }: { children: ReactNode }) => (
  <tr>
    <td
      className="card-pad"
      style={{
        backgroundColor: palette.card,
        border: "1px solid rgba(20, 20, 19, 0.05)",
        borderRadius: "28px",
        boxShadow:
          "0 2px 6px rgba(20, 20, 19, 0.02), 0 12px 28px rgba(20, 20, 19, 0.03)",
        padding: "22px 24px 32px",
      }}
    >
      <table
        border={0}
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        width="100%"
      >
        <tbody>{children}</tbody>
      </table>
    </td>
  </tr>
);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const primaryButtonStyle: CSSProperties = {
  border: `1px solid ${palette.accentBorder}`,
  borderRadius: "999px",
  color: "#ffffff",
  display: "inline-block",
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "-0.1px",
  padding: "11px 24px",
  textDecoration: "none",
  textShadow: "0 1px 1px rgba(160, 50, 0, 0.25)",
};

export const PrimaryButton = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <a
    className="btn-3d"
    href={href}
    style={primaryButtonStyle}
    rel="noreferrer"
    target="_blank"
  >
    {children}
  </a>
);

interface StepProps {
  body: string;
  href: string;
  icon: string;
  label: string;
  title: string;
}

export const Step = ({ body, href, icon, label, title }: StepProps) => (
  <table
    border={0}
    cellPadding={0}
    cellSpacing={0}
    role="presentation"
    width="100%"
  >
    <tbody>
      <tr>
        <td
          style={{ paddingTop: "1px", width: "32px" }}
          valign="top"
          width={32}
        >
          <img
            alt=""
            height={20}
            loading="lazy"
            src={icon}
            style={{ display: "block", height: "20px", width: "20px" }}
            width={20}
          />
        </td>
        <td valign="top">
          <h3
            style={{
              color: palette.ink,
              fontSize: "15px",
              fontWeight: 700,
              letterSpacing: "-0.2px",
              lineHeight: "20px",
              margin: "0 0 5px",
            }}
          >
            {title}
          </h3>
          <p
            style={{
              color: palette.body,
              fontSize: "13.5px",
              fontWeight: 500,
              lineHeight: "1.5",
              margin: "0 0 8px",
            }}
          >
            {body}
          </p>
          <a
            className="step-link"
            href={href}
            style={{
              color: palette.accent,
              display: "inline-block",
              fontSize: "13.5px",
              fontWeight: 700,
              textDecoration: "none",
            }}
            rel="noreferrer"
            target="_blank"
          >
            <span>{label}</span>
            <img
              alt=""
              height={13}
              loading="lazy"
              src={emailConfig.assets.icons.arrow}
              style={{
                display: "inline-block",
                height: "13px",
                marginLeft: "3px",
                verticalAlign: "-2px",
                width: "13px",
              }}
              width={13}
            />
          </a>
        </td>
      </tr>
    </tbody>
  </table>
);

export const HeroImage = ({ alt, src }: { alt: string; src: string }) => (
  <tr>
    <td align="center" style={{ paddingBottom: "24px" }}>
      <img
        alt={alt}
        height={408}
        loading="lazy"
        src={src}
        style={{
          borderRadius: "14px",
          display: "block",
          height: "auto",
          maxWidth: "408px",
          width: "100%",
        }}
        width={408}
      />
    </td>
  </tr>
);

// ---------------------------------------------------------------------------
// App download
// ---------------------------------------------------------------------------

const storeButtonStyle: CSSProperties = {
  borderBottom: "3px solid #000000",
  borderRadius: "12px",
  color: "#ffffff",
  display: "inline-block",
  fontFamily: EMAIL_FONT_STACK,
  padding: "11px 16px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const StoreButton = ({
  href,
  icon,
  kicker,
  name,
}: {
  href: string;
  icon: string;
  kicker: string;
  name: string;
}) => (
  <a
    className="store-btn"
    href={href}
    style={storeButtonStyle}
    rel="noreferrer"
    target="_blank"
  >
    <table border={0} cellPadding={0} cellSpacing={0} role="presentation">
      <tbody>
        <tr>
          <td
            className="store-icon-cell"
            style={{ paddingRight: "9px", verticalAlign: "middle" }}
          >
            <img
              alt=""
              className="store-icon"
              height={26}
              loading="lazy"
              src={icon}
              style={{ display: "block", height: "26px", width: "auto" }}
            />
          </td>
          <td style={{ verticalAlign: "middle" }}>
            <div
              className="store-kicker"
              style={{
                color: "#b9b4ad",
                fontSize: "10px",
                fontWeight: 600,
                lineHeight: "1.2",
              }}
            >
              {kicker}
            </div>
            <div
              className="store-label"
              style={{
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 700,
                lineHeight: "1.2",
              }}
            >
              {name}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </a>
);

export const AppDownload = () => (
  <tr>
    <td
      style={{
        borderBottom: `1px solid ${palette.hairline}`,
        paddingBottom: "24px",
        paddingTop: "24px",
      }}
    >
      <p
        style={{
          color: palette.ink,
          fontSize: "14px",
          fontWeight: 700,
          letterSpacing: "-0.2px",
          margin: "0 0 14px",
        }}
      >
        Get the {emailConfig.company.name} app
      </p>
      <table
        border={0}
        cellPadding={0}
        cellSpacing={0}
        className="store-table"
        role="presentation"
      >
        <tbody>
          <tr>
            <td
              className="store-td"
              style={{ paddingRight: "10px", verticalAlign: "middle" }}
            >
              <StoreButton
                href={emailConfig.app.playStore}
                icon={emailConfig.assets.icons.playStore}
                kicker="Get it on"
                name="Play Store"
              />
            </td>
            <td className="store-td" style={{ verticalAlign: "middle" }}>
              <StoreButton
                href={emailConfig.app.androidRelease}
                icon={emailConfig.assets.icons.github}
                kicker="Get it on"
                name="GitHub"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p
        style={{
          color: palette.faint,
          fontSize: "12px",
          fontWeight: 500,
          lineHeight: "1.5",
          margin: "12px 0 0",
        }}
      >
        Android APK &amp; releases on GitHub &middot; iOS on the way
      </p>
    </td>
  </tr>
);

export const SignOff = ({ children }: { children: ReactNode }) => (
  <tr>
    <td
      style={{
        borderBottom: `1px solid ${palette.hairline}`,
        paddingBottom: "24px",
      }}
    >
      <p
        style={{
          color: palette.muted,
          fontSize: "13px",
          fontWeight: 500,
          lineHeight: "1.55",
          margin: 0,
        }}
      >
        {children}
      </p>
    </td>
  </tr>
);

export const Colophon = () => (
  <tr>
    <td style={{ paddingTop: "20px" }}>
      <p
        style={{
          color: palette.faint,
          fontSize: "11.5px",
          fontWeight: 500,
          lineHeight: "1.6",
          margin: 0,
        }}
      >
        {emailConfig.company.name} &middot; Singularity Works
        <br />
        <a
          href={emailConfig.company.website}
          style={{ color: palette.faint, textDecoration: "underline" }}
          rel="noreferrer"
          target="_blank"
        >
          asocialmedia.cc
        </a>
        {" · "}
        <a
          href={emailConfig.legal.privacy.url}
          style={{ color: palette.faint, textDecoration: "underline" }}
          rel="noreferrer"
          target="_blank"
        >
          {emailConfig.legal.privacy.text}
        </a>
        {" · "}
        <a
          href={emailConfig.legal.terms.url}
          style={{ color: palette.faint, textDecoration: "underline" }}
          rel="noreferrer"
          target="_blank"
        >
          {emailConfig.legal.terms.text}
        </a>
      </p>
      <p
        style={{
          color: palette.faint,
          fontSize: "11.5px",
          fontWeight: 500,
          lineHeight: "1.6",
          margin: "8px 0 0",
        }}
      >
        {emailConfig.brandLine}
      </p>
    </td>
  </tr>
);
