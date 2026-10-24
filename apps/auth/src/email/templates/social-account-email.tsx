// oxlint-disable next/no-head-element, jsx-a11y/html-has-lang, jsx-a11y/lang, jsx-a11y/control-has-associated-label, next/no-img-element
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

export type SocialProvider = "bluesky" | "google" | "reddit";

const PROVIDER_COPY: Record<SocialProvider, { iconAlt: string; name: string }> =
  {
    bluesky: { iconAlt: "Bluesky", name: "Bluesky" },
    google: { iconAlt: "Google", name: "Google" },
    reddit: { iconAlt: "Reddit", name: "Reddit" },
  };

export type SocialLinkAction = "linked" | "unlinked";

export interface SocialAccountEmailProps {
  action: SocialLinkAction;
  /** Bluesky @handle or the Google/Reddit address tied to the account. */
  accountName: string;
  changedAt: string;
  provider: SocialProvider;
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

// The provider mark sits on the card, not in a tile: a filled chip behind a
// brand logo reads as a component-library default, and the marks are already
// full colour.
const ProviderRow = ({ provider }: { provider: SocialProvider }) => {
  const copy = PROVIDER_COPY[provider];

  return (
    <tr>
      <td style={{ paddingBottom: "16px" }}>
        <img
          alt={copy.iconAlt}
          height={28}
          loading="lazy"
          src={emailConfig.assets.socialIcons[provider]}
          style={{ display: "block", height: "28px", width: "28px" }}
          width={28}
        />
      </td>
    </tr>
  );
};

// Sent when a provider is connected to or disconnected from an existing
// account. Linking is an account-security event, so the notice names the
// provider and the identity that was attached.
export const SocialAccountEmail = ({
  accountName,
  action,
  changedAt,
  provider,
}: SocialAccountEmailProps) => {
  const { company } = emailConfig;
  const { name } = PROVIDER_COPY[provider];
  const title =
    action === "linked"
      ? `${name} connected to your account`
      : `${name} disconnected from your account`;
  const lead =
    action === "linked"
      ? `${name} can now be used to sign in to your ${company.name} account.`
      : `${name} can no longer be used to sign in to your ${company.name} account.`;

  return (
    <EmailDocument preheader={title} title={title}>
      <EmailCanvas>
        <EmailCard
          footerImage={emailConfig.assets.emailFooter}
          headerImage={emailConfig.assets.transactionalHeader}
        >
          <ProviderRow provider={provider} />

          <tr>
            <td style={{ paddingBottom: "18px" }}>
              <h1 className="hero-title" style={headingStyle}>
                {title}
              </h1>
              <p style={leadStyle}>{lead}</p>
            </td>
          </tr>

          <tr>
            <td>
              <DetailList
                items={[
                  { label: "Provider", value: name },
                  { label: "Account", value: accountName },
                  {
                    label: action === "linked" ? "Connected" : "Disconnected",
                    value: changedAt,
                  },
                ]}
              />
            </td>
          </tr>

          <tr>
            <td style={{ paddingBottom: "22px" }}>
              <PrimaryButton href={emailConfig.app.settingsLinkedAccounts}>
                Manage connected accounts
              </PrimaryButton>
            </td>
          </tr>

          <tr>
            <td style={{ paddingBottom: "24px" }}>
              <p style={finePrintStyle}>
                {action === "linked"
                  ? "You can disconnect it at any time from Settings."
                  : "Your password and any other connected accounts still work."}
              </p>
            </td>
          </tr>

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

export const getSocialAccountEmailHtml = (
  props: SocialAccountEmailProps
): Promise<string> =>
  Promise.resolve(
    `${DOCTYPE}\n${renderToStaticMarkup(
      <SocialAccountEmail
        accountName={props.accountName}
        action={props.action}
        changedAt={props.changedAt}
        provider={props.provider}
      />
    )}`
  );
