import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ username: string }>;
}

export default async function FollowingPage(props: PageProps) {
  const params = await props.params;
  const { username } = params;
  redirect(`/users/${encodeURIComponent(username)}/followers?tab=following`);
}
