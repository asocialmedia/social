// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang, jsx-a11y/control-has-associated-label
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

interface FrameProps {
  children: React.ReactNode;
  preheader: string;
  title: string;
}

// Shared frame for the credential and account-change notices below. Same card
// shell as every other account email so the set reads as one system.
const Frame = ({ children, preheader, title }: FrameProps) => {
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

const Heading = ({ lead, title }: { lead: string; title: string }) => (
  <tr>
    <td style={{ paddingBottom: "18px" }}>
      <h1 className="hero-title" style={headingStyle}>
        {title}
      </h1>
      <p style={leadStyle}>{lead}</p>
    </td>
  </tr>
);

const Action = ({ children }: { children: React.ReactNode }) => (
  <tr>
    <td style={{ padding: "0 0 22px" }}>{children}</td>
  </tr>
);

const FinePrint = ({ children }: { children: React.ReactNode }) => (
  <tr>
    <td style={{ paddingBottom: "24px" }}>
      <p style={finePrintStyle}>{children}</p>
    </td>
  </tr>
);

// ---------------------------------------------------------------------------
// Passkey added / removed
// ---------------------------------------------------------------------------

export interface PasskeyChangedEmailProps {
  action: "added" | "removed";
  changedAt: string;
  /** The label the user gave the passkey, e.g. "MacBook Touch ID". */
  passkeyName: string;
}

// A passkey is a full sign-in credential, so adding or removing one is as
// consequential as changing a password and carries the same notice weight.
export const PasskeyChangedEmail = ({
  action,
  changedAt,
  passkeyName,
}: PasskeyChangedEmailProps) => {
  const { company } = emailConfig;
  const added = action === "added";
  const title = added ? "A passkey was added" : "A passkey was removed";

  return (
    <Frame
      preheader={`${title} on your ${company.name} account.`}
      title={title}
    >
      <Heading
        lead={
          added
            ? `A passkey can now be used to sign in to your ${company.name} account.`
            : `A passkey can no longer be used to sign in to your ${company.name} account.`
        }
        title={title}
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "Passkey", value: passkeyName },
              { label: added ? "Added" : "Removed", value: changedAt },
            ]}
          />
        </td>
      </tr>
      <Action>
        <PrimaryButton href={emailConfig.app.settingsSecurity}>
          Review account security
        </PrimaryButton>
      </Action>
      <FinePrint>
        {added
          ? "If you did not add this passkey, remove it from Settings and change your password."
          : "Your password and any other passkeys still work."}
      </FinePrint>
    </Frame>
  );
};

export const getPasskeyChangedEmailHtml = (
  props: PasskeyChangedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <PasskeyChangedEmail
        action={props.action}
        changedAt={props.changedAt}
        passkeyName={props.passkeyName}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// Backup codes regenerated
// ---------------------------------------------------------------------------

export interface BackupCodesRegeneratedEmailProps {
  changedAt: string;
  /** How many codes the new set contains. */
  codeCount: number;
}

export const BackupCodesRegeneratedEmail = ({
  changedAt,
  codeCount,
}: BackupCodesRegeneratedEmailProps) => {
  const { company } = emailConfig;
  const title = "Your backup codes were regenerated";

  return (
    <Frame
      preheader={`${title}. The previous codes no longer work.`}
      title={title}
    >
      <Heading
        lead={`A new set of backup codes was created for your ${company.name} account.`}
        title={title}
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "New codes", value: String(codeCount) },
              { label: "Regenerated", value: changedAt },
            ]}
          />
        </td>
      </tr>
      <FinePrint>
        Every code from the previous set stopped working the moment the new set
        was created. Store the new codes somewhere safe.
      </FinePrint>
    </Frame>
  );
};

export const getBackupCodesRegeneratedEmailHtml = (
  props: BackupCodesRegeneratedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <BackupCodesRegeneratedEmail
        changedAt={props.changedAt}
        codeCount={props.codeCount}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// Username changed
// ---------------------------------------------------------------------------

export interface UsernameChangedEmailProps {
  changedAt: string;
  /** When the previous handle stops redirecting to the new one. */
  previousUsernameExpiresAt: string;
  previousUsername: string;
  username: string;
}

export const UsernameChangedEmail = ({
  changedAt,
  previousUsernameExpiresAt,
  previousUsername,
  username,
}: UsernameChangedEmailProps) => {
  const { company } = emailConfig;
  const title = "Your username was changed";

  return (
    <Frame
      preheader={`Your ${company.name} username is now @${username}.`}
      title={title}
    >
      <Heading
        lead={`Your ${company.name} username has been changed.`}
        title={title}
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "New username", value: `@${username}` },
              { label: "Previous", value: `@${previousUsername}` },
              { label: "Changed", value: changedAt },
            ]}
          />
        </td>
      </tr>
      <FinePrint>
        @{previousUsername} keeps pointing at your profile until{" "}
        {previousUsernameExpiresAt}, then it becomes available to anyone.
      </FinePrint>
    </Frame>
  );
};

export const getUsernameChangedEmailHtml = (
  props: UsernameChangedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <UsernameChangedEmail
        changedAt={props.changedAt}
        previousUsername={props.previousUsername}
        previousUsernameExpiresAt={props.previousUsernameExpiresAt}
        username={props.username}
      />
    )}`
  );

// ---------------------------------------------------------------------------
// Account merge / resolution completed
// ---------------------------------------------------------------------------

export interface AccountMergedEmailProps {
  completedAt: string;
  /** The handle that survived the resolution. */
  keptUsername: string;
  /** "merge" folds the other account in; "discard" leaves it behind. */
  mode: "discard" | "merge";
  /** The handle that is no longer usable. */
  removedUsername: string;
}

// The most consequential notice in the set: two accounts were resolved into
// one, and afterwards there is no way to tell from the outside which profile
// absorbed which. The notice names both sides so the outcome is auditable.
export const AccountMergedEmail = ({
  completedAt,
  keptUsername,
  mode,
  removedUsername,
}: AccountMergedEmailProps) => {
  const { company } = emailConfig;
  const title =
    mode === "merge" ? "Your accounts were merged" : "An account was discarded";

  return (
    <Frame preheader={`${title} on ${company.name}.`} title={title}>
      <Heading
        lead={
          mode === "merge"
            ? `Two ${company.name} accounts were combined into one.`
            : `A second ${company.name} account was discarded during an account review.`
        }
        title={title}
      />
      <tr>
        <td>
          <DetailList
            items={[
              { label: "Kept", value: `@${keptUsername}` },
              {
                label: "Mode",
                value: mode === "merge" ? "Merged" : "Discarded",
              },
              { label: "Other account", value: `@${removedUsername}` },
              { label: "Completed", value: completedAt },
            ]}
          />
        </td>
      </tr>
      <Action>
        <PrimaryButton href={emailConfig.app.settingsSecurity}>
          Review account security
        </PrimaryButton>
      </Action>
      <FinePrint>
        Sign in with @{keptUsername} from now on. If you did not expect this,
        contact us immediately.
      </FinePrint>
    </Frame>
  );
};

export const getAccountMergedEmailHtml = (
  props: AccountMergedEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <AccountMergedEmail
        completedAt={props.completedAt}
        keptUsername={props.keptUsername}
        mode={props.mode}
        removedUsername={props.removedUsername}
      />
    )}`
  );
