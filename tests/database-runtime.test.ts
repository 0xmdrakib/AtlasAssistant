import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeDatabaseUrl } from "../lib/database-url";
import { markSessionUnavailable, readSessionHealth } from "../lib/session-health";

test("Vercel uses Supabase transaction pooling while preserving credentials and SSL settings", () => {
  const source = "postgresql://postgres.project:encoded%40password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=15";
  const result = new URL(runtimeDatabaseUrl(source, true)!);
  assert.equal(result.port, "6543");
  assert.equal(result.password, "encoded%40password");
  assert.equal(result.username, "postgres.project");
  assert.equal(result.searchParams.get("sslmode"), "require");
  assert.equal(result.searchParams.get("connection_limit"), "1");
  assert.equal(result.searchParams.get("pgbouncer"), "true");
  assert.equal(runtimeDatabaseUrl(source, false), source, "Local commands and migrations retain the original URL");
});

test("connection pooling does not rewrite other database hosts or direct Supabase ports", () => {
  for (const source of ["postgresql://user:pass@localhost:5432/test", "postgresql://user:pass@db.project.supabase.co:5432/postgres", "postgresql://user:pass@pooler.supabase.com.attacker.test:5432/postgres"]) {
    const result = new URL(runtimeDatabaseUrl(source, true)!);
    assert.equal(result.hostname, new URL(source).hostname);
    assert.equal(result.port, "5432");
    assert.equal(result.searchParams.get("pgbouncer"), null);
  }
  assert.equal(runtimeDatabaseUrl(undefined, true), undefined);
});

test("a database session lookup failure is distinguished from an expired session without leaking across requests", async () => {
  const [failed, expired, authenticated] = await Promise.all([
    readSessionHealth(async () => { markSessionUnavailable(); await Promise.resolve(); return null; }),
    readSessionHealth(async () => null),
    readSessionHealth(async () => ({ user: { id: "test-user" } })),
  ]);
  assert.deepEqual(failed, { session: null, unavailable: true });
  assert.deepEqual(expired, { session: null, unavailable: false });
  assert.equal(authenticated.unavailable, false);
  assert.equal(authenticated.session.user.id, "test-user");
});
