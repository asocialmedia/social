import { DARK_PALETTE, LIGHT_PALETTE } from "./colors";

export { BRAND_COLORS } from "./colors";
export interface AppTheme {
  auxLink: string;
  auxLinkSeparator: string;
  bgGradient: readonly [string, string, string];
  bgImageOpacity: number;
  cardBg: string;
  cardBorder: string;
  cardInnerLip: string;
  cardShadow: string;
  containerBg: string;
  dividerLine: string;
  dividerText: string;
  errorBannerBg: string;
  errorBannerBorder: string;
  errorBannerLip: string;
  errorBannerText: string;
  eyeIcon: string;
  guestLink: string;
  headingDivider: string;
  inputBg: string;
  inputBorder: string;
  inputBorderTop: string;
  inputLabel: string;
  inputPlaceholder: string;
  inputText: string;
  loginBtnBorder: string;
  passkeyBg: string;
  passkeyBorder: string;
  passkeyIcon: string;
  passkeyLip: string;
  socialBtnBg: string;
  socialBtnBorder: string;
  socialBtnLip: string;
  socialBtnPressedBg: string;
  socialBtnText: string;
}

export const THEMES: { dark: AppTheme; light: AppTheme } = {
  dark: {
    auxLink: DARK_PALETTE.auxLink,
    auxLinkSeparator: DARK_PALETTE.auxLinkSeparator,
    bgGradient: [
      "rgba(255, 149, 0, 0.08)",
      "rgba(31, 31, 31, 0.72)",
      "rgba(23, 23, 23, 0.94)",
    ],
    bgImageOpacity: 0.22,
    cardBg: DARK_PALETTE.cardBackground,
    cardBorder: DARK_PALETTE.cardBorder,
    cardInnerLip: DARK_PALETTE.cardInnerLip,
    cardShadow: DARK_PALETTE.cardShadow,
    containerBg: DARK_PALETTE.background,
    dividerLine: DARK_PALETTE.divider,
    dividerText: DARK_PALETTE.dividerText,
    errorBannerBg: DARK_PALETTE.errorBackground,
    errorBannerBorder: DARK_PALETTE.errorBorder,
    errorBannerLip: DARK_PALETTE.errorInnerLip,
    errorBannerText: DARK_PALETTE.errorText,
    eyeIcon: DARK_PALETTE.iconMuted,
    guestLink: DARK_PALETTE.guestLink,
    headingDivider: DARK_PALETTE.divider,
    inputBg: DARK_PALETTE.inputBackground,
    inputBorder: DARK_PALETTE.inputBorder,
    inputBorderTop: DARK_PALETTE.inputBorderTop,
    inputLabel: DARK_PALETTE.inputLabel,
    inputPlaceholder: DARK_PALETTE.inputPlaceholder,
    inputText: DARK_PALETTE.inputText,
    loginBtnBorder: DARK_PALETTE.loginBtnBorder,
    passkeyBg: DARK_PALETTE.passkeyBackground,
    passkeyBorder: DARK_PALETTE.passkeyBorder,
    passkeyIcon: DARK_PALETTE.passkeyIcon,
    passkeyLip: DARK_PALETTE.passkeyInnerLip,
    socialBtnBg: DARK_PALETTE.socialBackground,
    socialBtnBorder: DARK_PALETTE.socialBorder,
    socialBtnLip: DARK_PALETTE.socialInnerLip,
    socialBtnPressedBg: DARK_PALETTE.socialPressedBackground,
    socialBtnText: DARK_PALETTE.socialText,
  },
  light: {
    auxLink: LIGHT_PALETTE.auxLink,
    auxLinkSeparator: LIGHT_PALETTE.auxLinkSeparator,
    bgGradient: [
      "rgba(255, 149, 0, 0.06)",
      "rgba(249, 249, 249, 0.82)",
      "rgba(243, 244, 246, 0.96)",
    ],
    bgImageOpacity: 0.18,
    cardBg: LIGHT_PALETTE.cardBackground,
    cardBorder: LIGHT_PALETTE.cardBorder,
    cardInnerLip: LIGHT_PALETTE.cardInnerLip,
    cardShadow: LIGHT_PALETTE.cardShadow,
    containerBg: LIGHT_PALETTE.background,
    dividerLine: LIGHT_PALETTE.divider,
    dividerText: LIGHT_PALETTE.dividerText,
    errorBannerBg: LIGHT_PALETTE.errorBackground,
    errorBannerBorder: LIGHT_PALETTE.errorBorder,
    errorBannerLip: LIGHT_PALETTE.errorInnerLip,
    errorBannerText: LIGHT_PALETTE.errorText,
    eyeIcon: LIGHT_PALETTE.iconMuted,
    guestLink: LIGHT_PALETTE.guestLink,
    headingDivider: LIGHT_PALETTE.divider,
    inputBg: LIGHT_PALETTE.inputBackground,
    inputBorder: LIGHT_PALETTE.inputBorder,
    inputBorderTop: LIGHT_PALETTE.inputBorderTop,
    inputLabel: LIGHT_PALETTE.inputLabel,
    inputPlaceholder: LIGHT_PALETTE.inputPlaceholder,
    inputText: LIGHT_PALETTE.inputText,
    loginBtnBorder: LIGHT_PALETTE.loginBtnBorder,
    passkeyBg: LIGHT_PALETTE.passkeyBackground,
    passkeyBorder: LIGHT_PALETTE.passkeyBorder,
    passkeyIcon: LIGHT_PALETTE.passkeyIcon,
    passkeyLip: LIGHT_PALETTE.passkeyInnerLip,
    socialBtnBg: LIGHT_PALETTE.socialBackground,
    socialBtnBorder: LIGHT_PALETTE.socialBorder,
    socialBtnLip: LIGHT_PALETTE.socialInnerLip,
    socialBtnPressedBg: LIGHT_PALETTE.socialPressedBackground,
    socialBtnText: LIGHT_PALETTE.socialText,
  },
};
