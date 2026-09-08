import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const databaseUrl = process.env.SAVED_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set SAVED_TEST_DATABASE_URL to an isolated localhost _test database.");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
  throw new Error("Feed integration tests require an isolated localhost _test database.");
}
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.OWNER_EMAILS = "";
const { prisma } = await import("../lib/prisma");
const { queryPublicFeed } = await import("../lib/public-feed");
const prefix = `feed-test-${randomUUID()}`;
const now = new Date();
const id = (suffix: string) => `${prefix}-${suffix}`;
const item = (suffix: string, section = "tech", source = "rss", age = 0, score = 1) => ({
  id: id(suffix), sourceId: id(source), section, title: suffix, summary: `Summary ${suffix}`,
  url: `https://example.test/${id(suffix)}`, topics: ["science"], score,
  createdAt: new Date(now.getTime() - age * 86400000), publishedAt: now,
});

before(async () => {
  await prisma.source.createMany({ data: ["rss", "ai", "discovery", "faith"].map((name) => ({
    id: id(name), section: name === "faith" ? "faith" : "tech", name, type: name === "faith" ? "rss" : name,
    url: `https://source.test/${id(name)}`,
  })) });
  await prisma.item.createMany({ data: [
    item("newer", "tech", "rss", 0, 2), item("lower-score"), item("yesterday", "tech", "rss", 2),
    item("expired", "tech", "rss", 8), item("other", "global"), item("generated", "tech", "ai"),
    item("discovered", "tech", "discovery"), item("retired", "faith", "faith"),
    item("legacy-retired", "Universe + Faith"), item("mislabelled", "tech", "faith"),
  ] });
  await prisma.itemTranslation.createMany({ data: [
    { itemId: id("newer"), lang: "en", title: "Do not replace original title", summary: "Cache text", aiSummary: "English AI summary" },
    { itemId: id("newer"), lang: "bn", title: "Private translation", summary: "Translated text", aiSummary: "Translated AI" },
  ] });
  await prisma.user.create({ data: { id: id("user"), email: `${prefix}@example.test` } });
  await prisma.savedItem.createMany({ data: ["retired", "newer"].map((name) => ({ userId: id("user"), itemId: id(name) })) });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: id("user") } });
  await prisma.item.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.source.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});

test("public feed preserves ordering, filters, original content and English summaries", async () => {
  const oneDay = await queryPublicFeed("tech", 1);
  const own = oneDay.items.filter((row) => row.id.startsWith(prefix));
  assert.deepEqual(own.map((row) => row.id), [id("newer"), id("lower-score")]);
  assert.equal(own[0].title, "newer");
  assert.equal(own[0].aiSummary, "English AI summary");
  assert.equal(own[0].sourceName, "rss");
  assert.equal(own[0].createdAt, now.toISOString());
  const week = await queryPublicFeed("tech", 7);
  assert.ok(week.items.some((row) => row.id === id("yesterday")));
  const all = await queryPublicFeed(null, 7);
  assert.ok(all.items.some((row) => row.id === id("other")));
  assert.ok(!JSON.stringify(all).includes("Private translation"));
  assert.ok(!all.items.some((row) => [id("retired"), id("legacy-retired"), id("mislabelled")].includes(row.id)));
});

test("retirement is repeatable, cascades saved references, and preserves other content", async () => {
  for (let i = 0; i < 2; i++) {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/changes/20260909_retire_faith.sql", "--schema", "prisma/schema.prisma"], { stdio: "pipe" });
  }
  assert.equal(await prisma.source.count({ where: { id: id("faith") } }), 0);
  assert.equal(await prisma.item.count({ where: { id: { in: [id("retired"), id("legacy-retired"), id("mislabelled")] } } }), 0);
  const saved = await prisma.savedItem.findMany({ where: { userId: id("user") } });
  assert.deepEqual(saved.map((row) => row.itemId), [id("newer")]);
  assert.ok(await prisma.item.findUnique({ where: { id: id("newer") } }));
});
