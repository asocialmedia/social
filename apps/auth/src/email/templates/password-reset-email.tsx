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
  padding: "20px 0 48px",
  maxWidth: "700px",
};

const box = {
  backgroundColor: "rgba(255, 255, 255, 0.98)",
  backdropFilter: "blur(10px)",
  borderRadius: "24px",
  padding: "40px",
  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  border: "1px solid #e5e7eb",
};

const heading = {
  fontSize: "24px",
  fontWeight: "600",
  color: emailConfig.assets.colors.textDark,
  textAlign: "center" as const,
  margin: "0 0 12px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  color: emailConfig.assets.colors.text,
  margin: "0 0 24px",
};

const card = {
  backgroundColor: emailConfig.assets.colors.cardBg,
  borderRadius: "16px",
  padding: "24px",
  border: `1px solid ${emailConfig.assets.colors.border}`,
  marginBottom: "16px",
  textAlign: "center" as const,
};

const emoji = {
  fontSize: "48px",
  marginBottom: "16px",
  display: "block",
};

const subheading = {
  fontSize: "20px",
  fontWeight: "600",
  color: emailConfig.assets.colors.textDark,
  margin: "0 0 12px",
};

const button = {
  backgroundColor: emailConfig.assets.colors.primary,
  borderRadius: "12px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "16px 40px",
  boxShadow: "0 4px 6px -1px rgba(249, 115, 22, 0.25)",
};

const warningCard = {
  backgroundColor: emailConfig.assets.colors.warningBg,
  borderRadius: "16px",
  padding: "24px",
  border: `1px solid ${emailConfig.assets.colors.warningBorder}`,
  marginBottom: "16px",
  textAlign: "center" as const,
};

const warningText = {
  fontSize: "14px",
  color: emailConfig.assets.colors.warning,
  margin: "0",
  fontStyle: "italic",
};

const helpTitle = {
  fontSize: "18px",
  fontWeight: "600",
  color: emailConfig.assets.colors.textDark,
  margin: "0 0 12px",
};

const links = {
  margin: "0 0 16px",
};

const link = {
  color: emailConfig.assets.colors.primary,
  textDecoration: "none",
  fontSize: "14px",
  margin: "0 12px",
};

const footerLinks = {
  textAlign: "center" as const,
  marginBottom: "16px",
};

const footerLink = {
  color: emailConfig.assets.colors.text,
  textDecoration: "none",
  fontSize: "12px",
  margin: "0 8px",
};

const footer = {
  fontSize: "12px",
  color: emailConfig.assets.colors.textLight,
  textAlign: "center" as const,
  margin: "0",
};
