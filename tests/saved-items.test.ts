import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.SAVED_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set SAVED_TEST_DATABASE_URL to an isolated localhost PostgreSQL database ending in _test.");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
  throw new Error("Saved-items integration tests may only run on an isolated localhost _test database.");
}
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.OWNER_EMAILS = "";

const { prisma } = await import("../lib/prisma");
const { getSavedItems, setItemSaved, SavedItemError } = await import("../lib/saved-items");
const prefix = `saved-test-${randomUUID()}`;
const users: string[] = [];
let sourceId: string;
let itemIds: string[];

async function user(paid = false) {
  const row = await prisma.user.create({ data: {
    email: `${randomUUID()}@saved-test.example`,
    subscriptionPlan: paid ? "paid" : "free",
    subscriptionStatus: paid ? "active" : "free",
    subscriptionCurrentPeriodEnd: paid ? new Date(Date.now() + 86400000) : null,
  } });
  users.push(row.id);
  return row.id;
}
function hasCode(code: string) {
  return (error: unknown) => error instanceof SavedItemError && error.code === code;
}

before(async () => {
  const source = await prisma.source.create({ data: { section: "tech", name: prefix, type: "rss", url: `https://example.test/${prefix}` } });
  sourceId = source.id;
  itemIds = Array.from({ length: 65 }, (_, i) => `${prefix}-${i}`);
  await prisma.item.createMany({ data: itemIds.map((id) => ({
    id, sourceId, section: "tech", title: `Test story ${id}`, summary: "Original content.",
    url: `https://example.test/${id}`, topics: ["testing"], publishedAt: new Date(),
  })) });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (sourceId) {
    await prisma.item.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
  }
  await prisma.$disconnect();
});

test("concurrent free-plan saves never exceed 10; overflow is rejected", async () => {
  const id = await user();
  const results = await Promise.allSettled(itemIds.slice(0, 24).map((item) => setItemSaved(id, item, true)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 10);
  for (const result of results.filter((r) => r.status === "rejected")) {
    assert.ok(result.status === "rejected" && hasCode("SAVE_LIMIT_REACHED")(result.reason));
  }
  const state = await getSavedItems(id);
  assert.equal(state.count, 10);
  assert.equal(state.limit, 10);
  assert.equal(state.remaining, 0);
  assert.equal((await setItemSaved(id, state.items[0].id, true)).count, 10, "duplicate PUT at capacity is idempotent");
  await setItemSaved(id, state.items[0].id, false);
  assert.equal((await setItemSaved(id, itemIds[30], true)).count, 10, "unsaving immediately frees a slot");
});

test("concurrent Pro saves are capped at 50", async () => {
  const id = await user(true);
  const results = await Promise.allSettled(itemIds.slice(0, 55).map((item) => setItemSaved(id, item, true)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 50);
  assert.equal(results.filter((result) => result.status === "rejected" && hasCode("SAVE_LIMIT_REACHED")(result.reason)).length, 5);
  const state = await getSavedItems(id);
  assert.deepEqual({ count: state.count, limit: state.limit, remaining: state.remaining, plan: state.plan }, { count: 50, limit: 50, remaining: 0, plan: "paid" });
});

test("duplicate concurrent saves occupy only one slot", async () => {
  const id = await user();
  await Promise.all(Array.from({ length: 15 }, () => setItemSaved(id, itemIds[0], true)));
  assert.equal((await getSavedItems(id)).count, 1);
  await setItemSaved(id, itemIds[0], false);
  assert.equal((await setItemSaved(id, itemIds[0], false)).count, 0);
});

test("saved collections and unsave operations are scoped to the current user", async () => {
  const first = await user();
  const second = await user();
  await setItemSaved(first, itemIds[0], true);
  await setItemSaved(second, itemIds[1], true);
  await setItemSaved(second, itemIds[0], false);
  assert.deepEqual((await getSavedItems(first)).items.map((item) => item.id), [itemIds[0]]);
  assert.deepEqual((await getSavedItems(second)).items.map((item) => item.id), [itemIds[1]]);
});

test("deleting original content cascades to every collection and immediately frees capacity", async () => {
  const first = await user();
  const second = await user();
  const deleted = itemIds[64];
  for (const item of [...itemIds.slice(0, 9), deleted]) await setItemSaved(first, item, true);
  await setItemSaved(second, deleted, true);
  await prisma.item.delete({ where: { id: deleted } });
  assert.equal(await prisma.savedItem.count({ where: { itemId: deleted } }), 0);
  assert.equal((await getSavedItems(first)).remaining, 1);
  assert.equal((await getSavedItems(second)).count, 0);
  assert.equal((await setItemSaved(first, itemIds[10], true)).count, 10);
  await assert.rejects(() => setItemSaved(second, deleted, true), hasCode("ITEM_NOT_FOUND"));
});

test("expired Pro keeps existing saves while applying the free limit to new saves", async () => {
  const id = await user(true);
  for (const item of itemIds.slice(0, 12)) await setItemSaved(id, item, true);
  await prisma.user.update({ where: { id }, data: { subscriptionCurrentPeriodEnd: new Date(Date.now() - 1000) } });
  const expired = await getSavedItems(id);
  assert.equal(expired.plan, "free");
  assert.equal(expired.count, 12);
  assert.equal(expired.limit, 10);
  assert.equal(expired.remaining, 0);
  await assert.rejects(() => setItemSaved(id, itemIds[13], true), hasCode("SAVE_LIMIT_REACHED"));
  for (const item of itemIds.slice(0, 3)) await setItemSaved(id, item, false);
  assert.equal((await setItemSaved(id, itemIds[13], true)).count, 10);
  await prisma.user.update({ where: { id }, data: { subscriptionCurrentPeriodEnd: new Date(Date.now() + 86400000) } });
  assert.equal((await setItemSaved(id, itemIds[14], true)).limit, 50);
});

test("saved content stays live and is not limited by feed date filters", async () => {
  const id = await user();
  const itemId = itemIds[63];
  await setItemSaved(id, itemId, true);
  await prisma.item.update({ where: { id: itemId }, data: { title: "Updated original title", createdAt: new Date(Date.now() - 30 * 86400000) } });
  const state = await getSavedItems(id);
  assert.equal(state.items[0].title, "Updated original title");
  assert.equal(state.count, 1);
});

test("unknown content and users cannot create dangling saves; deleting an account cascades", async () => {
  const id = await user();
  await assert.rejects(() => setItemSaved(id, "missing-content", true), hasCode("ITEM_NOT_FOUND"));
  await assert.rejects(() => setItemSaved("missing-user", itemIds[0], true), hasCode("UNAUTHORIZED"));
  assert.equal((await getSavedItems(id)).count, 0);
  await setItemSaved(id, itemIds[0], true);
  await prisma.user.delete({ where: { id } });
  assert.equal(await prisma.savedItem.count({ where: { userId: id } }), 0);
});
