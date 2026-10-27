const WEAK_SSL_MODES = new Set(["prefer", "require", "verify-ca"]);

/**
 * pg 8 treats sslmode=require|prefer|verify-ca as verify-full and writes a
 * SECURITY WARNING to stderr on every cold start. Vercel records that stderr
 * line as a runtime error. Rewrite those modes to verify-full unless the
 * string already opts into libpq compatibility.
 */
export function normalizePostgresConnectionString(connectionString: string): string {
  if (/[?&]uselibpqcompat=/i.test(connectionString)) return connectionString;

  return connectionString.replace(
    /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/gi,
    (_match, prefix: string, mode: string) => {
      if (!WEAK_SSL_MODES.has(mode.toLowerCase())) return `${prefix}${mode}`;
      return `${prefix}verify-full`;
    },
  );
}
