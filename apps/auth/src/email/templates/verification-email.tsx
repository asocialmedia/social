// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang
import { emailConfig } from "../config";
import {
  EmailBanner,
  actionLink,
  bannerUrl,
  code,
  container,
  heading,
  main,
  paragraph,
} from "./theme";

interface VerificationEmailProps {
  verificationUrl: string;
}

export const VerificationEmail = ({
  verificationUrl,
}: VerificationEmailProps) => (
  <html>
    <head />
    <body style={main}>
      <div style={container}>
        <EmailBanner />
        <h1 style={heading}>Verify your email</h1>
        <p style={paragraph}>
          Please verify your email address within{" "}
          {emailConfig.templates.verification.expiryTime} to complete your
          registration.
        </p>
        <a href={verificationUrl} style={actionLink}>
          {verificationUrl}
        </a>
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

export const getVerificationEmailHtml = (
  verificationUrl: string
): Promise<string> => {
  const safeUrl = escapeHtml(verificationUrl);
  const expiryTime = escapeHtml(emailConfig.templates.verification.expiryTime);
  const companyName = escapeHtml(emailConfig.company.name);

  return Promise.resolve(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Verify your email</title>
  </head>
  <body style="background-color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;margin:0;padding:0">
    <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:600px;margin:0 auto;padding:24px 0 48px">
      <tbody>
        <tr style="width:100%">
          <td>
            <img alt="${companyName} banner" height="252" src="${bannerUrl}" style="display:block;height:auto;width:100%;border:0" width="600" />
            <h1 style="color:#111111;font-size:22px;font-weight:700;margin:24px 0 12px;line-height:1.3">Verify your email</h1>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">Please verify your email address within ${expiryTime} to complete your registration.</p>
            <p style="margin:0 0 16px">
              <a href="${safeUrl}" style="color:#ff9500;display:inline-block;font-size:15px;font-weight:600;max-width:100%;overflow-wrap:anywhere;text-decoration:underline" target="_blank">${safeUrl}</a>
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`);
};

interface OTPVerificationEmailProps {
  otp: string;
}

export const OTPVerificationEmail = ({ otp }: OTPVerificationEmailProps) => (
  <html lang="en">
    <head />
    <body style={main}>
      <div style={container}>
        <EmailBanner />
        <h1 style={heading}>Your verification code</h1>
        <p style={code}>{otp}</p>
        <p style={paragraph}>
          Use this code to verify your email address and complete your
          registration. It will expire in 5 minutes.
        </p>
        <p style={paragraph}>
          If you didn't request this code, you can safely ignore this email.
        </p>
      </div>
    </body>
  </html>
);

export const getOTPVerificationEmailHtml = (otp: string): Promise<string> => {
  const safeOtp = escapeHtml(otp);
  const companyName = escapeHtml(emailConfig.company.name);

  return Promise.resolve(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Your verification code</title>
  </head>
  <body style="background-color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;margin:0;padding:0">
    <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:600px;margin:0 auto;padding:24px 0 48px">
      <tbody>
        <tr style="width:100%">
          <td>
            <img alt="${companyName} banner" height="252" src="${bannerUrl}" style="display:block;height:auto;width:100%;border:0" width="600" />
            <h1 style="color:#111111;font-size:22px;font-weight:700;margin:24px 0 12px;line-height:1.3">Your verification code</h1>
            <p style="color:#111111;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:30px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${safeOtp}</p>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">Use this code to verify your email address and complete your registration. It will expire in 5 minutes.</p>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">If you didn't request this code, you can safely ignore this email.</p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`);
};
