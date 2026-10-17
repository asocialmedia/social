// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang, jsx-a11y/control-has-associated-label
import { renderToStaticMarkup } from "react-dom/server";

import { emailConfig } from "../config";
import {
  AppDownload,
  BrandHeader,
  Colophon,
  EmailBanner,
  EmailCanvas,
  EmailCard,
  EmailDocument,
  HeroImage,
  PrimaryButton,
  SignOff,
  Step,
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

// The onboarding email. It ships the one thing that matters (verify), then the
// four things worth doing next, each linking to a route the app really serves.
// Copy uses the product's own vocabulary - Fleets, eddies, Gusts, Aura,
// communities - and only claims what the app does today.
export const VerificationEmail = ({
  verificationUrl,
}: VerificationEmailProps) => {
  const { app, assets, company } = emailConfig;

  return (
    <EmailDocument
      preheader="Confirm your email and the feed starts learning you."
      title="Verify your email"
    >
      <EmailCanvas>
        <BrandHeader />
        <EmailCard>
          <HeroImage alt={company.name} src={assets.welcomeHero} />

          <tr>
            <td style={{ padding: "0 4px" }}>
              <table
                border={0}
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                width="100%"
              >
                <tbody>
                  <tr>
                    <td style={{ paddingBottom: "18px" }}>
                      <h1
                        className="hero-title"
                        style={{
                          color: "#141413",
                          fontSize: "23px",
                          fontWeight: 700,
                          letterSpacing: "-0.4px",
                          lineHeight: "1.25",
                          margin: "0 0 8px",
                        }}
                      >
                        Verify your email to join {company.name}
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
                        One tap and you are in. This link expires in{" "}
                        {emailConfig.templates.verification.expiryTime}.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style={{ paddingBottom: "32px" }}>
                      <PrimaryButton href={verificationUrl}>
                        Verify email
                      </PrimaryButton>
                    </td>
                  </tr>

                  <tr>
                    <td style={{ paddingBottom: "26px" }}>
                      <Step
                        body="Add a profile picture and a short bio so people know who they are following."
                        href={app.settingsProfile}
                        icon={assets.icons.account}
                        label="Edit your profile"
                        title="Make it yours"
                      />
                    </td>
                  </tr>

                  <tr>
                    <td style={{ paddingBottom: "26px" }}>
                      <Step
                        body="Follow the people whose work you like and join the communities that match your interests. Your For you feed sharpens from there."
                        href={app.discover}
                        icon={assets.icons.people}
                        label="Find people and communities"
                        title="Find your people"
                      />
                    </td>
                  </tr>

                  <tr>
                    <td style={{ paddingBottom: "26px" }}>
                      <Step
                        body="Post a Fleet, reply with an eddie, or share a short video Gust. Aura is earned for the contributions that genuinely help."
                        href={app.feed}
                        icon={assets.icons.compose}
                        label="Make your first Fleet"
                        title="Say something"
                      />
                    </td>
                  </tr>

                  <tr>
                    <td style={{ paddingBottom: "28px" }}>
                      <Step
                        body="Four feeds, one tap apart: For you, Trending, Latest and Following. Switch between them whenever you want."
                        href={app.feedTrending}
                        icon={assets.icons.feeds}
                        label="Switch your feed"
                        title="Four feeds, your call"
                      />
                    </td>
                  </tr>

                  <SignOff>
                    See you out there,
                    <br />
                    The {company.name} team
                  </SignOff>

                  <AppDownload />
                  <Colophon />
                </tbody>
              </table>
            </td>
          </tr>
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

export const getVerificationEmailHtml = (
  verificationUrl: string
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <VerificationEmail verificationUrl={escapeHtml(verificationUrl)} />
    )}`
  );

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

export const getTwoFactorOTPEmailHtml = (otp: string): Promise<string> => {
  const safeOtp = escapeHtml(otp);
  const companyName = escapeHtml(emailConfig.company.name);

  return Promise.resolve(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Your security code</title>
  </head>
  <body style="background-color:#ffffff;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;margin:0;padding:0">
    <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:600px;margin:0 auto;padding:24px 0 48px">
      <tbody>
        <tr style="width:100%">
          <td>
            <img alt="${companyName} banner" height="252" src="${bannerUrl}" style="display:block;height:auto;width:100%;border:0" width="600" />
            <h1 style="color:#111111;font-size:22px;font-weight:700;margin:24px 0 12px;line-height:1.3">Your security code</h1>
            <p style="color:#111111;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:30px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${safeOtp}</p>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">Use this code to complete your sign-in. It expires in 5 minutes.</p>
            <p style="color:#444444;font-size:15px;line-height:24px;margin:0 0 16px">If you didn't try to sign in, change your password and review your account security.</p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`);
};
