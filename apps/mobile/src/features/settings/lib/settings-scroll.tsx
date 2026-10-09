// Section scroll registry for settings search.
//
// Web's settings search navigates to a tab and then scrolls `#sectionId` into
// view. Native has no DOM, so each section reports its offset within the
// active tab's scroll content through `SectionAnchor`; the search records a
// target and the screen scrolls the active ScrollView to it once the tab has
// rendered.
import type { ReactNode, RefObject } from "react";
import { View } from "react-native";
import type { LayoutChangeEvent, ScrollView, ViewStyle } from "react-native";

import type { SettingsTab } from "./settings-tabs";

interface SectionOffset {
  tab: SettingsTab;
  y: number;
}

const offsets = new Map<string, SectionOffset>();

export function registerSectionOffset(
  id: string,
  tab: SettingsTab,
  y: number
): void {
  offsets.set(id, { tab, y });
}

// Wraps a settings section so its scroll offset is known to the search. The
// optional style carries the parent card's `gap` when the anchor sits inside a
// card whose children would otherwise lose their spacing to this wrapper.
export function SectionAnchor({
  afterId,
  children,
  id,
  style,
  tab,
}: {
  // The id of an enclosing anchor, when this section is nested inside a card
  // that is itself anchored (e.g. the email half of the identity card). The
  // offset is the parent's content offset plus this view's local y.
  afterId?: string;
  children: ReactNode;
  id: string;
  style?: ViewStyle;
  tab: SettingsTab;
}) {
  const onLayout = (event: LayoutChangeEvent) => {
    const parent = afterId ? offsets.get(afterId) : undefined;
    registerSectionOffset(
      id,
      tab,
      (parent?.y ?? 0) + event.nativeEvent.layout.y
    );
  };
  return (
    <View onLayout={onLayout} style={style}>
      {children}
    </View>
  );
}

// Scrolls the section's owning tab ScrollView to it once it has been laid out.
// Offsets are measured after render, so a deep link or search selection that
// requests a scroll polls briefly until the offset and the ref both exist,
// then scrolls.
export function scrollToSection(
  sectionId: string,
  refs: Record<SettingsTab, RefObject<ScrollView | null>>
): void {
  let attempts = 0;
  const tick = () => {
    const target = offsets.get(sectionId);
    const ref = target ? refs[target.tab] : null;
    if (target && ref?.current) {
      ref.current.scrollTo({ animated: true, y: Math.max(0, target.y - 12) });
      return;
    }
    attempts += 1;
    if (attempts < 24) {
      setTimeout(tick, 50);
    }
  };
  tick();
}

// The catalog mirrors web's SETTINGS_CATALOG: the searchable entries, their
// keywords, and which tab and section they live in.
export interface SettingsSearchEntry {
  description: string;
  id: string;
  keywords: string[];
  label: string;
  sectionId: string;
  tab: SettingsTab;
}

export const SETTINGS_CATALOG: SettingsSearchEntry[] = [
  {
    description: "Change the name shown on your profile",
    id: "display-name",
    keywords: ["name", "displayname", "display name", "nickname", "handle"],
    label: "Display name",
    sectionId: "settings-profile",
    tab: "profile",
  },
  {
    description: "Edit your bio and about text",
    id: "bio",
    keywords: ["bio", "about", "description", "intro"],
    label: "Bio",
    sectionId: "settings-profile",
    tab: "profile",
  },
  {
    description: "Link your GitHub, X, LinkedIn and Reddit",
    id: "social-links",
    keywords: [
      "social",
      "links",
      "github",
      "twitter",
      "x",
      "linkedin",
      "reddit",
      "connect",
    ],
    label: "Social links",
    sectionId: "settings-profile",
    tab: "profile",
  },
  {
    description: "Change your @username handle",
    id: "username",
    keywords: ["username", "handle", "name", "@"],
    label: "Username",
    sectionId: "settings-username",
    tab: "account",
  },
  {
    description: "Update the email for your account",
    id: "email",
    keywords: ["email", "mail", "address", "inbox"],
    label: "Email address",
    sectionId: "settings-email",
    tab: "account",
  },
  {
    description: "Connect or disconnect Google and Reddit",
    id: "linked-accounts",
    keywords: [
      "linked",
      "accounts",
      "google",
      "reddit",
      "connect",
      "oauth",
      "link",
      "sign-in",
      "signin",
      "sign in",
    ],
    label: "Sign-in methods",
    sectionId: "settings-linked-accounts",
    tab: "account",
  },
  {
    description: "Reset your password via email",
    id: "password",
    keywords: [
      "password",
      "pass",
      "security",
      "reset",
      "login",
      "credential",
      "auth",
    ],
    label: "Change password",
    sectionId: "settings-password",
    tab: "security",
  },
  {
    description: "Turn email or authenticator two-factor on or off",
    id: "two-factor",
    keywords: [
      "2fa",
      "two-factor",
      "two factor",
      "mfa",
      "authenticator",
      "totp",
      "otp",
      "security",
    ],
    label: "Two-factor authentication",
    sectionId: "settings-two-factor",
    tab: "security",
  },
  {
    description: "Sign in with your device instead of a password",
    id: "passkeys",
    keywords: [
      "passkey",
      "passkeys",
      "biometric",
      "fingerprint",
      "faceid",
      "device",
    ],
    label: "Passkeys",
    sectionId: "settings-passkeys",
    tab: "security",
  },
  {
    description: "See and sign out devices signed in to your account",
    id: "sessions",
    keywords: [
      "sessions",
      "devices",
      "active",
      "signed in",
      "sign out everywhere",
      "revoke",
    ],
    label: "Active sessions",
    sectionId: "settings-sessions",
    tab: "security",
  },
];

export const TAB_LABELS: Record<SettingsTab, string> = {
  account: "Account",
  profile: "Profile",
  security: "Security",
};
