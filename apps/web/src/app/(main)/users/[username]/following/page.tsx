import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

interface PageProps {
  params: Promise<{ username: string }>;
}

export default async function FollowingPage(props: PageProps) {
  const params = await props.params;
  const { username } = params;
  permanentRedirect(
    `/users/${encodeURIComponent(username)}/followers?tab=following`
  );
}
