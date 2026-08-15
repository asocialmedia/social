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
  <Html>
    {/* eslint-disable-next-line no-duplicate-head -- each email template owns its own Head */}
    <Head />
    <Preview>
      Welcome to asocialmedia! Verify your email to complete your registration.
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailBanner />
        <Text style={heading}>Verify your email</Text>
        <Text style={paragraph}>
          Please verify your email address within{" "}
          {emailConfig.templates.verification.expiryTime} to complete your
          registration.
        </Text>
        <Link href={verificationUrl} style={actionLink}>
          {verificationUrl}
        </Link>
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
    {/* eslint-disable-next-line no-duplicate-head -- each email template owns its own Head */}
    <Head />
    <Preview>Your verification code for asocialmedia</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailBanner />
        <Text style={heading}>Your verification code</Text>
        <Text style={code}>{otp}</Text>
        <Text style={paragraph}>
          Use this code to verify your email address and complete your
          registration. It will expire in 5 minutes.
        </Text>
        <Text style={paragraph}>
          If you didn't request this code, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const getOTPVerificationEmailHtml = (otp: string) =>
  render(<OTPVerificationEmail otp={otp} />);
