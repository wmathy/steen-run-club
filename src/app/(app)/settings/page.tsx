import { Suspense } from "react";
import { SettingsClient } from "@/components/settings-client";
import { getCurrentUser } from "@/lib/auth";
import { isStravaConfigured } from "@/lib/strava";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="mobile-page p-3 sm:p-4 md:p-8">
      <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
        <SettingsClient
          profile={user.coachProfile}
          stravaConnected={Boolean(user.stravaConnection)}
          stravaConfigured={isStravaConfigured()}
          stravaLastSyncedAt={
            user.stravaConnection?.lastSyncedAt?.toISOString() ?? null
          }
          userEmail={user.email}
          userName={user.name}
        />
      </Suspense>
    </div>
  );
}
