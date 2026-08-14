// biome-ignore lint/performance/noBarrelFile: This is a small auth package with limited exports
// oxlint-disable-next-line oxc/no-barrel-file
export * from "./core";
export {
  createPostSchema,
  type LoginValues,
  loginSchema,
  type SignUpValues,
  signUpSchema,
  type UpdateUserProfileValues,
  updateUserProfileSchema,
} from "./validation/schemas";
export {
  type EmailValidationOptions,
  type EmailValidationResult,
  validateEmailAdvanced,
  validateEmailBasic,
} from "./validation/server-validation";
