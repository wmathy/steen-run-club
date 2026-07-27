import { PlanView } from "@/components/plan-view";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const plan = await prisma.trainingPlan.findFirst({
    where: { userId: user.id, isActive: true },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: {
          workouts: { orderBy: { dayOfWeek: "asc" } },
        },
      },
    },
  });

  return (
    <div className="mobile-page mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-4 md:p-8">
      <div>
        <h1 className="text-xl font-bold">Training plan</h1>
        <p className="mt-1 text-sm text-muted">
          Structured weeks and workouts saved by your coach.
        </p>
      </div>
      <PlanView plan={plan} />
    </div>
  );
}
