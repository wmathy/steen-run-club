import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getSession();
  if (session.isLoggedIn) {
    redirect("/dashboard");
  }
  redirect("/login");
}
