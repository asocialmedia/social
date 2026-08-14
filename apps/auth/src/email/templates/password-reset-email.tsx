import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  render,
  Text,
} from "@react-email/components";

import { emailConfig } from "../config";
import {
  EmailBanner,
  actionLink,
  container,
  heading,
  main,
  paragraph,
} from "./theme";

interface PasswordResetEmailProps {
  resetUrl: string;
}

export const PasswordResetEmail = ({ resetUrl }: PasswordResetEmailProps) => (
  <Html>
    <Head />
    <Preview>
      We received a request to reset your Asocialmedia password. Click the link
      to reset it now.
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailBanner />
        <Text style={heading}>Password Reset Request</Text>
        <Text style={paragraph}>
          We received a request to reset your password for your Asocialmedia
          account.
        </Text>
        <Text style={paragraph}>
          Use the link below to reset your password. It will expire in{" "}
          {emailConfig.templates.passwordReset.expiryTime}.
        </Text>
        <Link href={resetUrl} style={actionLink}>
          {resetUrl}
        </Link>
        <Text style={paragraph}>
          If you didn't request this password reset, you can safely ignore this
          email. Your password will remain unchanged.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const getPasswordResetEmailHtml = (resetUrl: string) =>
  render(<PasswordResetEmail resetUrl={resetUrl} />);
