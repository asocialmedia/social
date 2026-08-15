// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang
import { emailConfig } from "../config";
import {
  EmailBanner,
  actionLink,
  bannerUrl,
  container,
  heading,
  main,
  paragraph,
} from "./theme";

interface PasswordResetEmailProps {
  resetUrl: string;
}

export const PasswordResetEmail = ({ resetUrl }: PasswordResetEmailProps) => (
  <html>
    <head />
    <body style={main}>
      <div style={container}>
        <EmailBanner />
        <h1 style={heading}>Password Reset Request</h1>
        <p style={paragraph}>
          We received a request to reset your password for your asocialmedia
          account.
        </p>
        <p style={paragraph}>
          Use the link below to reset your password. It will expire in{" "}
          {emailConfig.templates.passwordReset.expiryTime}.
        </p>
        <a href={resetUrl} style={actionLink}>
          {resetUrl}
        </a>
        <p style={paragraph}>
          If you didn't request this password reset, you can safely ignore this
          email. Your password will remain unchanged.
        </p>
      </div>
    </body>
  </html>
);

function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const getPasswordResetEmailHtml = (
  resetUrl: string
): Promise<string> => {
  const safeResetUrl = escapeHtml(resetUrl);
  const expiryTime = escapeHtml(emailConfig.templates.passwordReset.expiryTime);
  const companyName = escapeHtml(emailConfig.company.name);

  return Promise.resolve(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Password Reset Request</title>
  </head>
  <body style="background-color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;margin:0;padding:0">
    <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:600px;margin:0 auto;padding:24px 0 48px">
      <tbody>
        <tr style="width:100%">
          <td>
            <img alt="${companyName} banner" height="252" src="${bannerUrl}" style="display:block;height:auto;width:100%;border:0" width="600" />
            <h1 style="color:#111111;font-size:22px;font-weight:700;margin:24px 0 12px;line-height:1.3">Password Reset Request</h1>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">We received a request to reset your password for your ${companyName} account.</p>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">Use the link below to reset your password. It will expire in ${expiryTime}.</p>
            <p style="margin:0 0 16px">
              <a href="${safeResetUrl}" style="color:#ff9500;display:inline-block;font-size:15px;font-weight:600;max-width:100%;overflow-wrap:anywhere;text-decoration:underline" target="_blank">${safeResetUrl}</a>
            </p>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`);
};
