import { redirect } from "next/navigation";

export default function TrendingPage() {
  redirect("/discover?tab=trending");
}
