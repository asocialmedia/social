import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Link,
  Preview,
  render,
  Section,
  Text,
} from "@react-email/components";

import { emailConfig } from "../config";

interface PasswordResetEmailProps {
  resetUrl: string;
}

export const PasswordResetEmail = ({ resetUrl }: PasswordResetEmailProps) => (
  <Html>
    <Head />
    <Preview>
      We received a request to reset your Asocialmedia password. Click to reset
      it now.
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={box}>
          <Text style={heading}>Password Reset Request 🔒</Text>
          <Text style={paragraph}>
            We received a request to reset your password for your Asocialmedia
            account.
          </Text>

          <Section style={card}>
            <Text style={emoji}>🔑</Text>
            <Text style={subheading}>Reset Your Password</Text>
            <Text style={paragraph}>
              Click the button below to reset your password. This link will
              expire in {emailConfig.templates.passwordReset.expiryTime}.
            </Text>
            <Button href={resetUrl} style={button}>
              {emailConfig.templates.passwordReset.buttonText}
            </Button>
          </Section>

          <Section style={warningCard}>
            <Text style={warningText}>
              If you didn't request this password reset, please ignore this
              email. Your password will remain unchanged.
            </Text>
          </Section>

          <Section style={card}>
            <Text style={helpTitle}>Need Help? 💁‍♂️</Text>
            <Text style={paragraph}>
              Our support team is here to help you 24/7
            </Text>
            <Text style={links}>
              <Link
                href={`mailto:${emailConfig.company.supportEmail}`}
                style={link}
              >
                Contact Support
              </Link>
              {" • "}
              <Link href={emailConfig.company.website} style={link}>
                Help Center
              </Link>
            </Text>
          </Section>

          <Text style={footerLinks}>
            <Link href={emailConfig.legal.privacy.url} style={footerLink}>
              {emailConfig.legal.privacy.text}
            </Link>{" "}
            <Link href={emailConfig.legal.terms.url} style={footerLink}>
              {emailConfig.legal.terms.text}
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

export const getPasswordResetEmailHtml = (resetUrl: string) =>
  render(<PasswordResetEmail resetUrl={resetUrl} />);

const main = {
  backgroundColor: "#f9fafb",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container = {
  margin: "0 auto",
  maxWidth: "700px",
  padding: "20px 0 48px",
};

const box = {
  backdropFilter: "blur(10px)",
  backgroundColor: "rgba(255, 255, 255, 0.98)",
  border: "1px solid #e5e7eb",
  borderRadius: "24px",
  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  padding: "40px",
};

const heading = {
  color: emailConfig.assets.colors.textDark,
  fontSize: "24px",
  fontWeight: "600",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const paragraph = {
  color: emailConfig.assets.colors.text,
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 24px",
};

const card = {
  backgroundColor: emailConfig.assets.colors.cardBg,
  border: `1px solid ${emailConfig.assets.colors.border}`,
  borderRadius: "16px",
  marginBottom: "16px",
  padding: "24px",
  textAlign: "center" as const,
};

const emoji = {
  display: "block",
  fontSize: "48px",
  marginBottom: "16px",
};

const subheading = {
  color: emailConfig.assets.colors.textDark,
  fontSize: "20px",
  fontWeight: "600",
  margin: "0 0 12px",
};

const button = {
  backgroundColor: emailConfig.assets.colors.primary,
  borderRadius: "12px",
  boxShadow: "0 4px 6px -1px rgba(249, 115, 22, 0.25)",
  color: "#fff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "600",
  padding: "16px 40px",
  textAlign: "center" as const,
  textDecoration: "none",
};

const warningCard = {
  backgroundColor: emailConfig.assets.colors.warningBg,
  border: `1px solid ${emailConfig.assets.colors.warningBorder}`,
  borderRadius: "16px",
  marginBottom: "16px",
  padding: "24px",
  textAlign: "center" as const,
};

const warningText = {
  color: emailConfig.assets.colors.warning,
  fontSize: "14px",
  fontStyle: "italic",
  margin: "0",
};

const helpTitle = {
  color: emailConfig.assets.colors.textDark,
  fontSize: "18px",
  fontWeight: "600",
  margin: "0 0 12px",
};

const links = {
  margin: "0 0 16px",
};

const link = {
  color: emailConfig.assets.colors.primary,
  fontSize: "14px",
  margin: "0 12px",
  textDecoration: "none",
};

const footerLinks = {
  marginBottom: "16px",
  textAlign: "center" as const,
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
  margin: "0",
  textAlign: "center" as const,
};
