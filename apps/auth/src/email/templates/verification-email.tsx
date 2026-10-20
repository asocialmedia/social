// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang, jsx-a11y/control-has-associated-label
import { renderToStaticMarkup } from "react-dom/server";

import { emailConfig } from "../config";
import {
  AppDownload,
  BrandHeader,
  CodeBlock,
  Colophon,
  EmailCanvas,
  EmailCard,
  EmailDocument,
  FooterLinks,
  PrimaryButton,
  SignOff,
  Step,
  SupportNote,
  palette,
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
        <EmailCard
          footerImage={assets.emailFooter}
          headerImage={assets.welcomeHero}
        >
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
                        iconAlt="Profile"
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
                        iconAlt="People"
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
                        iconAlt="Compose"
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
                        iconAlt="Feeds"
                        label="Switch your feed"
                        title="Four feeds, your call"
                      />
                    </td>
                  </tr>

                  <SignOff>
                    See you out there,
                    <br />
                    The {company.name} team 🫶
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

// The signup verification code. Short by design: the header scene frames the
// card, the code is the single focal value, then the footer links.
export const OTPVerificationEmail = ({ otp }: OTPVerificationEmailProps) => {
  const { company } = emailConfig;

  return (
    <EmailDocument
      preheader={`Your ${company.name} verification code. It expires in 5 minutes.`}
      title="Your verification code"
    >
      <EmailCanvas>
        <BrandHeader />
        <EmailCard
          footerImage={emailConfig.assets.emailFooter}
          headerImage={emailConfig.assets.verificationHeader}
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
                Your verification code
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
                Enter this code to finish setting up your {company.name}{" "}
                account.
              </p>
            </td>
          </tr>

          <tr>
            <td>
              <CodeBlock code={otp} />
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
                This code expires in 5 minutes.
              </p>
            </td>
          </tr>

          <SignOff>
            See you out there,
            <br />
            The {company.name} team 🫶
          </SignOff>

          <SupportNote>
            If you did not request this code, contact us at{" "}
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
            and we will help you secure your account.
          </SupportNote>

          <FooterLinks />
        </EmailCard>
      </EmailCanvas>
    </EmailDocument>
  );
};

export const getOTPVerificationEmailHtml = (otp: string): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <OTPVerificationEmail otp={escapeHtml(otp)} />
    )}`
  );

interface TwoFactorOTPEmailProps {
  otp: string;
}

// The sign-in security code. Same shape as the verification code, different
// stake: the copy tells the reader what to do if it was not them.
export const TwoFactorOTPEmail = ({ otp }: TwoFactorOTPEmailProps) => {
  const { company } = emailConfig;

  return (
    <EmailDocument
      preheader={`Your ${company.name} security code. It expires in 5 minutes.`}
      title="Your security code"
    >
      <EmailCanvas>
        <BrandHeader />
        <EmailCard
          footerImage={emailConfig.assets.emailFooter}
          headerImage={emailConfig.assets.verificationHeader}
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
                Your security code
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
                Enter this code to finish signing in to your {company.name}{" "}
                account.
              </p>
            </td>
          </tr>

          <tr>
            <td>
              <CodeBlock code={otp} />
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
                This code expires in 5 minutes.
              </p>
            </td>
          </tr>

          <SignOff>
            See you out there,
            <br />
            The {company.name} team 🫶
          </SignOff>

          <SupportNote>
            If you did not try to sign in, change your password and contact us
            at{" "}
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

          <FooterLinks />
        </EmailCard>
      </EmailCanvas>
    </EmailDocument>
  );
};

export const getTwoFactorOTPEmailHtml = (otp: string): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <TwoFactorOTPEmail otp={escapeHtml(otp)} />
    )}`
  );
