/** Runtime connections on Vercel must use transaction pooling, not session slots.
 * Prisma CLI migrations still use DIRECT_URL from schema.prisma unchanged.
 */
export function runtimeDatabaseUrl(raw: string | undefined, serverless = process.env.VERCEL === "1") {
  if (!raw || !serverless) return raw;
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return raw;
  if (url.hostname.endsWith(".pooler.supabase.com") && ["", "5432", "6543"].includes(url.port)) {
    url.port = "6543";
    url.searchParams.set("pgbouncer", "true");
  }
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}
