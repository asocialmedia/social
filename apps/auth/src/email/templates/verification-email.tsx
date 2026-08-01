import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  render,
  Section,
  Text,
} from "@react-email/components";
import { emailConfig } from "../config";

interface VerificationEmailProps {
  verificationUrl: string;
}

export const VerificationEmail = ({
  verificationUrl,
}: VerificationEmailProps) => (
  <Html>
    <Head />
    <Preview>
      Welcome to Zephyr! Click to verify your email and complete your
      registration.
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={outerCard}>
          <Section style={header}>
            <Img
              alt={`${emailConfig.company.name} logo`}
              src="https://zr2.asocialmedia.cc/Assets/zephyr-logo.png"
              style={logo}
              width={120}
            />
          </Section>

          <Section style={innerCard}>
            <Text style={heading}>Verify your email</Text>
            <Text style={paragraph}>
              Please verify your email address within{" "}
              {emailConfig.templates.verification.expiryTime} to complete your
              registration.
            </Text>
            <Button href={verificationUrl} style={ctaButton}>
              {emailConfig.templates.verification.buttonText}
            </Button>

            <Hr style={divider} />

            <Text style={note}>
              If the button doesn't work, copy and paste this link into your
              browser:
            </Text>
            <Link href={verificationUrl} style={codeLink}>
              {verificationUrl}
            </Link>
          </Section>

          <Text style={footerLinks}>
            <Link href={emailConfig.legal.privacy.url} style={footerLink}>
              {emailConfig.legal.privacy.text}
            </Link>{" "}
            <Link href={emailConfig.legal.terms.url} style={footerLink}>
              {emailConfig.legal.terms.text}
            </Link>{" "}
            <Link href={emailConfig.legal.unsubscribe.url} style={footerLink}>
              {emailConfig.legal.unsubscribe.text}
            </Link>
          </Text>
          <Text style={footer}>
            © {new Date().getFullYear()} {emailConfig.company.name}. All rights
            reserved.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export const getVerificationEmailHtml = (verificationUrl: string) =>
  render(<VerificationEmail verificationUrl={verificationUrl} />);

interface OTPVerificationEmailProps {
  otp: string;
}

export const OTPVerificationEmail = ({ otp }: OTPVerificationEmailProps) => (
  <Html lang="en">
    <Head />
    <Preview>Your verification code for Zephyr</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={outerCard}>
          <Section style={header}>
            <Img
              alt={`${emailConfig.company.name} logo`}
              src="https://zr2.asocialmedia.cc/Assets/zephyr-logo.png"
              style={logo}
              width={120}
            />
          </Section>

          <Section style={innerCard}>
            <Text style={heading}>Your verification code</Text>
            <Text style={paragraph}>
              Use this code to verify your email address and complete your
              registration.
            </Text>

            <Section style={otpContainer}>
              <Text style={otpCode}>{otp}</Text>
            </Section>

            <Text style={otpNote}>
              This code will expire in 5 minutes. If you didn't request this
              code, please ignore this email.
            </Text>

            <Hr style={divider} />

            <Text style={note}>
              For security reasons, never share this code with anyone.
            </Text>
          </Section>

          <Text style={footerLinks}>
            <Link href={emailConfig.legal.privacy.url} style={footerLink}>
              {emailConfig.legal.privacy.text}
            </Link>{" "}
            <Link href={emailConfig.legal.terms.url} style={footerLink}>
              {emailConfig.legal.terms.text}
            </Link>{" "}
            <Link href={emailConfig.legal.unsubscribe.url} style={footerLink}>
              {emailConfig.legal.unsubscribe.text}
            </Link>
          </Text>
          <Text style={footer}>
            © {new Date().getFullYear()} {emailConfig.company.name}. All rights
            reserved.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export const getOTPVerificationEmailHtml = (otp: string) =>
  render(<OTPVerificationEmail otp={otp} />);

const brandPrimary = "#F85522";

const main = {
  backgroundColor: "#f9fafb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "24px 0 48px",
  maxWidth: "640px",
};

const outerCard = {
  backgroundColor: "#ffffff",
  border: `1px solid ${brandPrimary}`,
  borderRadius: "20px",
  boxShadow:
    "0 0 0 3px rgba(248,85,34,0.10), 0 8px 24px rgba(248,85,34,0.18), 0 10px 20px rgba(0,0,0,0.05)",
  padding: "8px",
};

const header = {
  padding: "20px 12px 0",
  textAlign: "center" as const,
};

const logo = {
  display: "block",
  margin: "0 auto 8px",
};

const innerCard = {
  backgroundColor: emailConfig.assets.colors.cardBg,
  border: `1px solid ${emailConfig.assets.colors.border}`,
  borderRadius: "16px",
  margin: "12px",
  padding: "28px 24px",
  textAlign: "center" as const,
};

const heading = {
  color: emailConfig.assets.colors.textDark,
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "0.2px",
  margin: "0 0 10px",
};

const paragraph = {
  color: emailConfig.assets.colors.text,
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 22px",
};

const ctaButton = {
  backgroundColor: brandPrimary,
  borderRadius: "9999px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 700,
  padding: "14px 28px",
  textAlign: "center" as const,
  textDecoration: "none",
};

const divider = {
  borderColor: emailConfig.assets.colors.border,
  margin: "24px 0 12px",
};

const note = {
  color: emailConfig.assets.colors.textLight,
  fontSize: "12px",
  margin: "0 0 8px",
};

const codeLink = {
  color: brandPrimary,
  display: "inline-block",
  fontSize: "12px",
  maxWidth: "100%",
  overflowWrap: "anywhere" as const,
  textDecoration: "underline",
};

const footerLinks = {
  textAlign: "center" as const,
  margin: "20px 0 8px",
};

const footerLink = {
  color: emailConfig.assets.colors.text,
  fontSize: "12px",
  margin: "0 8px",
  textDecoration: "none",
};

const footer = {
  color: emailConfig.assets.colors.textLight,
  fontSize: "12px",
  margin: "0 0 8px",
  textAlign: "center" as const,
};

const otpContainer = {
  backgroundColor: "#f8fafc",
  border: "2px solid rgba(248, 85, 34, 0.125)",
  borderRadius: "12px",
  margin: "24px 0",
  padding: "32px 24px",
  textAlign: "center" as const,
};

const otpCode = {
  color: brandPrimary,
  fontSize: "32px",
  fontWeight: 700,
  letterSpacing: "8px",
  margin: "0",
  fontFamily: "monospace",
};

const otpNote = {
  color: emailConfig.assets.colors.text,
  fontSize: "14px",
  lineHeight: "20px",
  margin: "16px 0 0",
  textAlign: "center" as const,
};
