// Android's SDK reports CommonStatusCodes.DEVELOPER_ERROR as the string "10".
export function isGoogleConfigurationError(code: string): boolean {
  return code === "10" || code === "DEVELOPER_ERROR";
}
