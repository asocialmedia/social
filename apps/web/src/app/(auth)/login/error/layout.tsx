import type React from "react";

export default function ErrorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

export const metadata = {
  description: "Authentication error occurred during login",
  title: "Authentication Error",
};
