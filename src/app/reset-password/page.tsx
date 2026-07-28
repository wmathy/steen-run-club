import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getSession } from "@/lib/session";

export default async function ResetPasswordPage() {
  const session = await getSession();
  if (session.isLoggedIn) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-8 sm:py-12">
      <Suspense
        fallback={
          <div className="text-sm text-muted">Loading reset form…</div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
