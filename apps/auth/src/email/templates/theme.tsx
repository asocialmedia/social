// oxlint-disable next/no-head-element, next/no-img-element, react/no-danger, jsx-a11y/control-has-associated-label
import type { CSSProperties, ReactNode } from "react";

import { emailConfig } from "../config";

// Sofia Pro Soft is the face the app itself uses (see packages/ui fonts). It is
// self-hosted by the web app and embedded below via @font-face, so clients that
// honour webfonts (Apple Mail, iOS, Thunderbird) render the real brand type.
// Everywhere else the stack falls back to the OS rounded face: no Google font
// is ever loaded over the network from inside an email.
export const EMAIL_FONT_STACK =
  "'SofiaProSoft', ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

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
    // The framed card: header and footer art run full-bleed, content sits in a
    // padded band between them.
    ".card-body{padding-left:26px!important;padding-right:26px!important}",
    // The store row is a two-cell table that shrink-wraps its buttons, so they
    // sit side by side packed to the left with a single gap and never stack.
    // No fixed column widths: a width:50% cell would strand them at the far
    // edges of the row.
    ".store-table{width:auto!important}",
    // Responsive: condense the frame; the store row stays side by side.
    "@media screen and (max-width:520px){",
    ".outer-pad{padding:24px 12px 36px!important}",
    ".card-pad{padding:20px 20px 28px!important;border-radius:24px!important}",
    ".card-frame{border-radius:22px!important}",
    ".card-img-top{border-top-left-radius:22px!important;border-top-right-radius:22px!important}",
    ".card-img-bottom{border-bottom-left-radius:22px!important;border-bottom-right-radius:22px!important}",
    ".card-body{padding-left:18px!important;padding-right:18px!important}",
    ".hero-title{font-size:21px!important}",
    ".code-value{font-size:26px!important;letter-spacing:5px!important}",
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
          alt={`${emailConfig.company.name} home`}
          height={72}
          loading="lazy"
          src={emailConfig.assets.headerLogo}
          style={{ display: "block", height: "72px", width: "auto" }}
        />
      </a>
    </td>
  </tr>
);

const HEADER_ART_ALT = `An illustration of Zeph, the ${emailConfig.company.name} mascot, at a desk above the city`;
const FOOTER_ART_ALT = `An illustrated flower meadow, a closing scene from ${emailConfig.company.name}`;

interface EmailCardProps {
  children: ReactNode;
  footerAlt?: string;
  footerImage?: string;
  headerAlt?: string;
  headerImage?: string;
}

// The card. When a header or footer image is passed it runs full-bleed across
// that edge and carries the matching radius, so the art and the card read as
// one object; the content sits in a padded band between them.
//
// The framing art is the one image that leaves a blank band when a client
// blocks it, so it always carries alt text describing the scene.
export const EmailCard = ({
  children,
  footerAlt = FOOTER_ART_ALT,
  footerImage,
  headerAlt = HEADER_ART_ALT,
  headerImage,
}: EmailCardProps) => (
  <tr>
    <td
      className="card-frame"
      style={{
        backgroundColor: palette.card,
        border: "1px solid rgba(20, 20, 19, 0.05)",
        borderRadius: "28px",
        boxShadow:
          "0 2px 6px rgba(20, 20, 19, 0.02), 0 12px 28px rgba(20, 20, 19, 0.03)",
        overflow: "hidden",
      }}
    >
      <table
        border={0}
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        width="100%"
      >
        <tbody>
          {headerImage ? (
            <tr>
              <td>
                <img
                  alt={headerAlt}
                  className="card-img-top"
                  loading="lazy"
                  src={headerImage}
                  style={{
                    borderTopLeftRadius: "28px",
                    borderTopRightRadius: "28px",
                    display: "block",
                    height: "auto",
                    width: "100%",
                  }}
                />
              </td>
            </tr>
          ) : null}
          <tr>
            <td
              className="card-body"
              style={{
                borderRadius: headerImage ? undefined : "28px 28px 0 0",
                padding: "26px 26px 30px",
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
          {footerImage ? (
            <tr>
              <td>
                <img
                  alt={footerAlt}
                  className="card-img-bottom"
                  loading="lazy"
                  src={footerImage}
                  style={{
                    borderBottomLeftRadius: "28px",
                    borderBottomRightRadius: "28px",
                    display: "block",
                    height: "auto",
                    width: "100%",
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </td>
  </tr>
);

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

// The one-time code, set as data: monospace, wide tracking, in a tonal well
// one step off the card so it reads as a value to copy, not decoration.
export const CodeBlock = ({ code: value }: { code: string }) => (
  <div
    className="code-value"
    style={{
      backgroundColor: "#f4f1ea",
      border: `1px solid ${palette.hairline}`,
      borderRadius: "14px",
      color: palette.ink,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: "30px",
      fontWeight: 700,
      letterSpacing: "8px",
      margin: "0 0 20px",
      padding: "16px 20px",
      textAlign: "center",
    }}
  >
    {value}
  </div>
);

interface StepProps {
  body: string;
  href: string;
  icon: string;
  iconAlt: string;
  label: string;
  title: string;
}
export const Step = ({
  body,
  href,
  icon,
  iconAlt,
  label,
  title,
}: StepProps) => (
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
            alt={iconAlt}
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
              alt={`${name} app icon`}
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
    <td style={{ paddingBottom: "18px" }}>
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
    <td
      style={{
        borderTop: `1px solid ${palette.hairline}`,
        paddingTop: "20px",
      }}
    >
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

// A short "if this was not you" line that points at support. Sits just above
// the legal footer in the transactional code emails.
export const SupportNote = ({ children }: { children: ReactNode }) => (
  <tr>
    <td style={{ paddingBottom: "20px" }}>
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

// The lighter footer: legal links and the brand line, without the
// "Singularity Works" colophon or the app-download block. Used by the code
// emails, which should stay short. A hairline opens the block so it reads as
// the page's baseline, not a third stray paragraph.
export const FooterLinks = () => (
  <tr>
    <td
      style={{
        borderTop: `1px solid ${palette.hairline}`,
        paddingTop: "20px",
      }}
    >
      <p
        style={{
          color: palette.faint,
          fontSize: "11.5px",
          fontWeight: 500,
          lineHeight: "1.6",
          margin: 0,
        }}
      >
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
