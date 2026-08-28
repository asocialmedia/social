"use server";

export function loginAction(__: { username: string; password: string }): {
  error?: string;
  success?: boolean;
} {
  return { success: true };
}
