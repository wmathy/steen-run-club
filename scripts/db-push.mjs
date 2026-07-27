/**
 * Push Prisma schema when DATABASE_URL is a real Postgres URL.
 * Skips (with a clear message) if missing/invalid so local/misconfigured
 * builds fail for the right reason later rather than obscure Prisma errors.
 */
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";

if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
  console.error(
    "\n❌ DATABASE_URL must be a Postgres connection string for build/deploy.\n" +
      "   Example (Neon pooled):\n" +
      "   postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require\n" +
      "   Set it in Vercel → Project → Settings → Environment Variables.\n",
  );
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["prisma", "db", "push", "--skip-generate"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
