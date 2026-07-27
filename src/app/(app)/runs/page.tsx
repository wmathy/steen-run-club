import { RunForm } from "@/components/run-form";
import { RunsList } from "@/components/runs-list";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function RunsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const runs = await prisma.run.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 100,
  });

  return (
    <div className="mobile-page mx-auto w-full max-w-3xl space-y-5 p-3 sm:space-y-6 sm:p-4 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Run log</h1>
          <p className="mt-1 text-sm text-muted">
            Manual entries, coach logs, or Strava imports.
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <RunForm />
        </div>
      </div>
      <RunsList runs={runs} />
    </div>
  );
}
