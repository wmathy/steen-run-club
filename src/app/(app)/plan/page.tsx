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

  // Plain JSON for the client component (avoids Date/Prisma serialization issues)
  const planForClient = plan
    ? {
        id: plan.id,
        title: plan.title,
        goal: plan.goal,
        startDate: plan.startDate.toISOString(),
        endDate: plan.endDate?.toISOString() ?? null,
        notes: plan.notes,
        weeks: plan.weeks.map((w) => ({
          id: w.id,
          weekNumber: w.weekNumber,
          focus: w.focus,
          notes: w.notes,
          workouts: w.workouts.map((wo) => ({
            id: wo.id,
            dayOfWeek: wo.dayOfWeek,
            type: wo.type,
            title: wo.title,
            description: wo.description,
            distanceMiles: wo.distanceMiles,
            durationMin: wo.durationMin,
            targetPace: wo.targetPace,
            completed: wo.completed,
            completionStatus:
              (wo.completionStatus as "as_planned" | "modified" | null) ??
              null,
          })),
        })),
      }
    : null;

  return (
    <div className="mobile-page mx-auto w-full max-w-6xl p-3 sm:p-4 md:p-8">
      {/* Header + scroll-to-today live inside PlanView */}
      <PlanView plan={planForClient} />
    </div>
  );
}
