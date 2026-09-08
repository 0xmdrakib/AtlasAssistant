import assert from "node:assert/strict";
import { test } from "node:test";
import { optimisticSavedState, reconcileSavedState, type PendingSave } from "../lib/saved-state";
import type { SavedState } from "../lib/saved-types";
import type { ContentItem } from "../lib/types";

const item = (id: string): ContentItem => ({
  id, title: id, summary: "A story", url: `https://example.test/${id}`, section: "tech", sourceName: "Test",
  topics: [], publishedAt: "2026-09-09T01:00:00.000Z", createdAt: "2026-09-09T01:00:00.000Z", score: 1,
});
const base: SavedState = { items: [], bookmarks: [], count: 0, remaining: 10, limit: 10, plan: "free" };
const save = (id: string): PendingSave => ({ item: item(id), saved: true, savedAt: "2026-09-09T02:00:00.000Z" });

test("pending saves update the card, count and remaining slots synchronously", () => {
  const state = optimisticSavedState(base, [save("one")])!;
  assert.equal(state.count, 1);
  assert.equal(state.remaining, 9);
  assert.equal(state.items[0].id, "one");
  assert.equal(base.count, 0, "confirmed state is untouched until the server acknowledges the save");
});

test("rejecting one save preserves all other pending and confirmed saves", () => {
  const first = optimisticSavedState(base, [save("first")])!;
  const pending = [save("rejected"), save("next")];
  assert.equal(optimisticSavedState(first, pending)!.count, 3);
  const rolledBack = optimisticSavedState(first, pending.slice(1))!;
  assert.deepEqual(rolledBack.items.map((entry) => entry.id), ["first", "next"]);
  assert.equal(rolledBack.remaining, 8);
});

test("failed removal restores the original content and save date", () => {
  const first = optimisticSavedState(base, [save("first")])!;
  assert.equal(optimisticSavedState(first, [{ ...save("first"), saved: false }])!.count, 0);
  assert.deepEqual(optimisticSavedState(first, []), first);
});

test("compact acknowledgement prunes deleted originals without reloading content", () => {
  const previous = optimisticSavedState(base, [save("deleted"), save("retained")])!;
  const snapshot = { ...base, count: 2, remaining: 8, bookmarks: [
    { itemId: "new", savedAt: "2026-09-09T03:00:00.000Z" },
    { itemId: "retained", savedAt: "2026-09-09T02:00:00.000Z" },
  ] };
  const confirmed = reconcileSavedState(previous, snapshot, [save("new")]);
  assert.deepEqual(confirmed.items.map((entry) => entry.id), ["new", "retained"]);
  assert.equal(confirmed.items[0].savedAt, "2026-09-09T03:00:00.000Z");
});

test("response for one save does not hide later pending saves", () => {
  const pending = [save("first"), save("second")];
  const first = optimisticSavedState(base, pending.slice(0, 1))!;
  const confirmed = reconcileSavedState(base, first, pending);
  const visible = optimisticSavedState(confirmed, pending.slice(1))!;
  assert.equal(visible.count, 2);
  assert.equal(visible.items.length, 2);
});
