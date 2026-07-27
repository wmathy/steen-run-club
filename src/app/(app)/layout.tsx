import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getCurrentUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-1 flex-col md:h-dvh md:flex-row md:overflow-hidden">
      <AppNav userName={user.name || user.email} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
