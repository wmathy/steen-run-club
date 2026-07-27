/**
 * Push Prisma schema when DATABASE_URL is a real Postgres URL.
 * During Vercel builds this creates tables automatically.
 */
import { spawnSync } from "node:child_process";

const url = (process.env.DATABASE_URL ?? "").trim();

console.log("\n========== Steen Run Club: database setup ==========");

if (!url) {
  console.error(`
❌ BUILD STOPPED: DATABASE_URL is not set on Vercel.

Fix (2 minutes):
  1. Open https://console.neon.tech → create project "steen-run-club"
  2. Copy the POOLED connection string (postgresql://...)
  3. Vercel → steen-run-club → Settings → Environment Variables
  4. Add:
       Name:  DATABASE_URL
       Value: (paste Neon string)
       Envs:  Production + Preview
  5. Redeploy

Do NOT use file:./prisma/dev.db — that only works on your laptop.
========================================================
`);
  process.exit(1);
}

if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
  console.error(`
❌ BUILD STOPPED: DATABASE_URL is not a Postgres URL.

You currently have something like a SQLite path, which Vercel cannot use.
It must look like:
  postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require

Get this from https://console.neon.tech → Connection details → Pooled.
========================================================
`);
  process.exit(1);
}

// Don't log the full URL (contains password); show host only
try {
  const host = new URL(url.replace(/^postgresql:/, "http:")).host;
  console.log(`✓ DATABASE_URL found (host: ${host})`);
} catch {
  console.log("✓ DATABASE_URL found");
}

console.log("Running: prisma db push …");
const result = spawnSync(
  "npx",
  ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if ((result.status ?? 1) !== 0) {
  console.error(`
❌ prisma db push failed.

Common causes:
  - Wrong password / expired Neon URL
  - Used "direct" URL instead of "pooled" (for serverless, use pooled)
  - Network / Neon project paused (open console.neon.tech to wake it)

========================================================
`);
  process.exit(result.status ?? 1);
}

console.log("✓ Database schema is up to date");
console.log("========================================================\n");
process.exit(0);
