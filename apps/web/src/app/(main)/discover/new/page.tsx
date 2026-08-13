import { redirect } from "next/navigation";

export default function NewUsersPage() {
  redirect("/discover?tab=new");
}
