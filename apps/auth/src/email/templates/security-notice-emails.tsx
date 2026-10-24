// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang, jsx-a11y/control-has-associated-label
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { emailConfig } from "../config";
import {
  Colophon,
  DetailList,
  EmailCanvas,
  EmailCard,
  EmailDocument,
  PrimaryButton,
  SignOff,
  SupportNote,
  palette,
} from "./theme";

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

// Every "something changed on your account" notice answers three questions in
// the same order: what happened, when and where, and what to do if it was not
// you. Sharing the frame keeps the six notices consistent and makes the copy
// the only thing a new notice has to get right.

interface NoticeFrameProps {
  children: ReactNode;
  preheader: string;
  title: string;
}

const headingStyle = {
  color: "#141413",
  fontSize: "21px",
  fontWeight: 700,
  letterSpacing: "-0.4px",
  lineHeight: "1.25",
  margin: "0 0 8px",
};

const leadStyle = {
  color: "#3d3c39",
  fontSize: "14px",
  fontWeight: 500,
  lineHeight: "1.5",
  margin: 0,
};

const finePrintStyle = {
  color: "#6e6b65",
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: "1.55",
  margin: 0,
};

const NoticeFrame = ({ children, preheader, title }: NoticeFrameProps) => {
  const { company } = emailConfig;

  return (
    <EmailDocument preheader={preheader} title={title}>
      <EmailCanvas>
        <EmailCard
          footerImage={emailConfig.assets.emailFooter}
          headerImage={emailConfig.assets.transactionalHeader}
        >
          {children}

          <SignOff>
            See you out there,
            <br />
            The {company.name} team 🫶
          </SignOff>

          <SupportNote>
            If you did not do this, contact us at{" "}
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

          <Colophon />
        </EmailCard>
      </EmailCanvas>
    </EmailDocument>
  );
};

interface HeadingRowProps {
  lead: string;
  title: string;
}

const HeadingRow = ({ lead, title }: HeadingRowProps) => (
  <tr>
    <td style={{ paddingBottom: "18px" }}>
      <h1 className="hero-title" style={headingStyle}>
        {title}
      </h1>
      <p style={leadStyle}>{lead}</p>
    </td>
  </tr>
);

const ActionRow = ({ children }: { children: ReactNode }) => (
  <tr>
    <td style={{ padding: "0 0 22px" }}>{children}</td>
  </tr>
);

const FinePrintRow = ({ children }: { children: ReactNode }) => (
  <tr>
    <td style={{ paddingBottom: "24px" }}>
      <p style={finePrintStyle}>{children}</p>
    </td>
  </tr>
);

// ---------------------------------------------------------------------------
// 1. Email address change
// ---------------------------------------------------------------------------

export interface EmailChangedEmailProps {
  newEmail: string;
  changedAt: string;
}

// Sent to the OLD address after the change completes, so the person who no
// longer controls the account still hears about it. The new address gets the
// verification code, not this notice.
export const EmailChangedEmail = ({
  newEmail,
  changedAt,
}: EmailChangedEmailProps) => {
  const { company } = emailConfig;

  return (
    <NoticeFrame
      preheader={`The email on your ${company.name} account was changed.`}
      title="Your email address was changed"
    >
      <HeadingRow
        lead={`The email address on your ${company.name} account has been changed.`}
        title="Your email address was changed"
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "New email", value: newEmail },
              { label: "Changed", value: changedAt },
            ]}
          />
        </td>
      </tr>
      <FinePrintRow>
        You are signed in with this address. If the change was not yours,
        contact us immediately so we can restore your account.
      </FinePrintRow>
    </NoticeFrame>
  );
};

export const getEmailChangedEmailHtml = (
  props: EmailChangedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <EmailChangedEmail
        changedAt={props.changedAt}
        newEmail={props.newEmail}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// 2. Password changed
// ---------------------------------------------------------------------------

export interface PasswordChangedEmailProps {
  changedAt: string;
  /** Every existing session was revoked, matching revokeSessionsOnPasswordReset. */
  signedOutEverywhere: boolean;
}

export const PasswordChangedEmail = ({
  changedAt,
  signedOutEverywhere,
}: PasswordChangedEmailProps) => {
  const { company } = emailConfig;

  return (
    <NoticeFrame
      preheader={`The password on your ${company.name} account was changed.`}
      title="Your password was changed"
    >
      <HeadingRow
        lead={`The password for your ${company.name} account was changed.`}
        title="Your password was changed"
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "Changed", value: changedAt },
              {
                label: "Other devices",
                value: signedOutEverywhere ? "Signed out" : "Still signed in",
              },
            ]}
          />
        </td>
      </tr>
      <ActionRow>
        <PrimaryButton href={emailConfig.app.settingsSecurity}>
          Review account security
        </PrimaryButton>
      </ActionRow>
      <FinePrintRow>
        {signedOutEverywhere
          ? "Every other session was signed out as a precaution. Sign in again on any device you still use."
          : "If you did not change your password, reset it now and review your active sessions."}
      </FinePrintRow>
    </NoticeFrame>
  );
};

export const getPasswordChangedEmailHtml = (
  props: PasswordChangedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <PasswordChangedEmail
        changedAt={props.changedAt}
        signedOutEverywhere={props.signedOutEverywhere}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// 3. Two-factor authentication changed
// ---------------------------------------------------------------------------

export type TwoFactorChange = "enabled" | "disabled" | "method-changed";

export interface TwoFactorChangedEmailProps {
  change: TwoFactorChange;
  changedAt: string;
  /** Human description of the resulting state, e.g. "Authenticator app and email codes". */
  method: string;
}

const TWO_FACTOR_COPY: Record<
  TwoFactorChange,
  { summary: string; title: string }
> = {
  disabled: {
    summary:
      "Two-factor authentication was turned off, so signing in now needs only your password.",
    title: "Two-factor authentication turned off",
  },
  enabled: {
    summary:
      "Two-factor authentication was turned on, so signing in now needs a second step.",
    title: "Two-factor authentication turned on",
  },
  "method-changed": {
    summary: "The second factor used to sign in to your account was changed.",
    title: "Two-factor authentication changed",
  },
};

export const TwoFactorChangedEmail = ({
  change,
  changedAt,
  method,
}: TwoFactorChangedEmailProps) => {
  const { company } = emailConfig;
  const copy = TWO_FACTOR_COPY[change];

  return (
    <NoticeFrame preheader={`${copy.title}.`} title={copy.title}>
      <HeadingRow
        lead={`${copy.summary} This is a notice for your ${company.name} account.`}
        title={copy.title}
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "Change", value: copy.title },
              { label: "Now", value: method },
              { label: "Changed", value: changedAt },
            ]}
          />
        </td>
      </tr>
      <ActionRow>
        <PrimaryButton href={emailConfig.app.settingsSecurity}>
          Review account security
        </PrimaryButton>
      </ActionRow>
      <FinePrintRow>
        If you did not make this change, your password may be compromised. Reset
        it now and contact us so we can restore your second factor.
      </FinePrintRow>
    </NoticeFrame>
  );
};

export const getTwoFactorChangedEmailHtml = (
  props: TwoFactorChangedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <TwoFactorChangedEmail
        change={props.change}
        changedAt={props.changedAt}
        method={props.method}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// 4. New sign-in to an existing account
// ---------------------------------------------------------------------------

export interface NewClientLoginEmailProps {
  browser: string;
  city: string | null;
  country: string | null;
  ipAddress: string | null;
  signedInAt: string;
}

// Not the first sign-in ever, and not a new account: an additional device or
// browser joined an account that already had sessions. The account owner is
// the only one who can say whether that was them.
export const NewClientLoginEmail = ({
  browser,
  city,
  country,
  ipAddress,
  signedInAt,
}: NewClientLoginEmailProps) => {
  const { company } = emailConfig;
  const location = [city, country].filter(Boolean).join(", ") || "Unknown";

  return (
    <NoticeFrame
      preheader={`A new device signed in to your ${company.name} account.`}
      title="New sign-in to your account"
    >
      <HeadingRow
        lead={`Your ${company.name} account was signed in to from a device it had not used before.`}
        title="New sign-in to your account"
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "Device", value: browser },
              { label: "Location", value: location },
              { label: "IP address", value: ipAddress ?? "Unknown" },
              { label: "Signed in", value: signedInAt },
            ]}
          />
        </td>
      </tr>
      <ActionRow>
        <PrimaryButton href={emailConfig.app.settingsSecurity}>
          Review active sessions
        </PrimaryButton>
      </ActionRow>
      <FinePrintRow>
        If this was you, nothing to do. If it was not, sign that session out
        from Settings, change your password, and contact us.
      </FinePrintRow>
    </NoticeFrame>
  );
};

export const getNewClientLoginEmailHtml = (
  props: NewClientLoginEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <NewClientLoginEmail
        browser={props.browser}
        city={props.city}
        country={props.country}
        ipAddress={props.ipAddress}
        signedInAt={props.signedInAt}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// 5. Message key reset
// ---------------------------------------------------------------------------

export interface MessageKeyResetEmailProps {
  /** Where the new key is created, e.g. "next time you open Messages". */
  nextStep: string;
  resetAt: string;
}

// Messages are end-to-end encrypted with a key the server can re-derive, so a
// reset is quiet for everyone else but loses only the resetting account's own
// history. That trade-off is the whole point of the email.
export const MessageKeyResetEmail = ({
  nextStep,
  resetAt,
}: MessageKeyResetEmailProps) => {
  const { company } = emailConfig;

  return (
    <NoticeFrame
      preheader={`Your ${company.name} messages key was reset.`}
      title="Your messages key was reset"
    >
      <HeadingRow
        lead={`The encryption key for your ${company.name} messages was reset.`}
        title="Your messages key was reset"
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "Reset", value: resetAt },
              { label: "New key", value: nextStep },
            ]}
          />
        </td>
      </tr>
      <FinePrintRow>
        Messages you sent and received before the reset cannot be read on this
        account any more. People you were talking to are not affected and do not
        need to do anything.
      </FinePrintRow>
    </NoticeFrame>
  );
};

export const getMessageKeyResetEmailHtml = (
  props: MessageKeyResetEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <MessageKeyResetEmail nextStep={props.nextStep} resetAt={props.resetAt} />
    )}`
  );
