import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";

export default async function SignupPage() {
  const session = await getSession();
  if (session.isLoggedIn) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-8 sm:py-12">
      <AuthForm mode="signup" />
    </main>
  );
}
