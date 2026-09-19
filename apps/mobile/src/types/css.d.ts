// Expo's ambient `*.css` declaration lives in the gitignored `expo-env.d.ts`,
// which is absent in CI and trips TS2882 on the side-effect import in
// `src/app/_layout.tsx`. Keep a committed declaration so typechecking does not
// depend on a generated, ignored file.
declare module "*.css";
