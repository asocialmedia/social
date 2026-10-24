// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang, jsx-a11y/control-has-associated-label
import { renderToStaticMarkup } from "react-dom/server";

import { emailConfig } from "../config";
import {
  Colophon,
  EmailCanvas,
  EmailCard,
  EmailDocument,
  PrimaryButton,
  SignOff,
  SupportNote,
  palette,
} from "./theme";

interface PasswordResetEmailProps {
  resetUrl: string;
}

// The password reset email. The highest-stakes transactional mail: one clear
// action, the expiry, and a plain "if this was not you" line. Same shell as the
// code emails so the set reads as one system.
export const PasswordResetEmail = ({ resetUrl }: PasswordResetEmailProps) => {
  const { company } = emailConfig;

  return (
    <EmailDocument
      preheader={`Reset your ${company.name} password. The link expires in ${emailConfig.templates.passwordReset.expiryTime}.`}
      title="Reset your password"
    >
      <EmailCanvas>
        <EmailCard
          footerImage={emailConfig.assets.emailFooter}
          headerImage={emailConfig.assets.transactionalHeader}
        >
          <tr>
            <td style={{ paddingBottom: "18px" }}>
              <h1
                className="hero-title"
                style={{
                  color: "#141413",
                  fontSize: "21px",
                  fontWeight: 700,
                  letterSpacing: "-0.4px",
                  lineHeight: "1.25",
                  margin: "0 0 8px",
                }}
              >
                Reset your password
              </h1>
              <p
                style={{
                  color: "#3d3c39",
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "1.5",
                  margin: 0,
                }}
              >
                We received a request to reset the password for your{" "}
                {company.name} account.
              </p>
            </td>
          </tr>

          <tr>
            <td style={{ paddingBottom: "20px" }}>
              <PrimaryButton href={resetUrl}>Reset password</PrimaryButton>
            </td>
          </tr>

          <tr>
            <td style={{ paddingBottom: "24px" }}>
              <p
                style={{
                  color: "#6e6b65",
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "1.55",
                  margin: 0,
                }}
              >
                This link expires in{" "}
                {emailConfig.templates.passwordReset.expiryTime}. Your password
                stays the same until you choose a new one.
              </p>
            </td>
          </tr>

          <SignOff>
            See you out there,
            <br />
            The {company.name} team 🫶
          </SignOff>

          <SupportNote>
            If you did not request this, you can ignore this email, or contact
            us at{" "}
            <a
              href={`mailto:${emailConfig.company.supportEmail}`}
              style={{
                color: palette.accent,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {emailConfig.company.supportEmail}
            </a>{" "}
            to secure your account.
          </SupportNote>

          <Colophon />
        </EmailCard>
      </EmailCanvas>
    </EmailDocument>
  );
};

function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

export const getPasswordResetEmailHtml = (resetUrl: string): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <PasswordResetEmail resetUrl={escapeHtml(resetUrl)} />
    )}`
  );
