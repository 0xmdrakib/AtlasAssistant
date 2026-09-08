import type { ContentItem } from "@/lib/types";
import type { SavedContentItem, SavedSnapshot, SavedState } from "@/lib/saved-types";

export type PendingSave = { item: ContentItem; saved: boolean; savedAt: string };

// Rebuild from confirmed data plus pending changes, so rejecting one save never undoes another.
export function optimisticSavedState(state: SavedState | null, changes: PendingSave[]): SavedState | null {
  if (!state) return null;
  const bookmarks = new Map(state.bookmarks.map((row) => [row.itemId, row]));
  const items = new Map(state.items.map((item) => [item.id, item]));
  for (const change of changes) {
    if (change.saved) {
      const savedAt = bookmarks.get(change.item.id)?.savedAt ?? change.savedAt;
      bookmarks.set(change.item.id, { itemId: change.item.id, savedAt });
      items.set(change.item.id, { ...change.item, savedAt });
    } else {
      bookmarks.delete(change.item.id);
      items.delete(change.item.id);
    }
  }
  const ordered = [...bookmarks.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.itemId.localeCompare(b.itemId));
  return {
    ...state, bookmarks: ordered, count: ordered.length, remaining: Math.max(0, state.limit - ordered.length),
    items: ordered.map((row) => items.get(row.itemId)).filter((item): item is SavedContentItem => Boolean(item)),
  };
}

export function reconcileSavedState(previous: SavedState | null, snapshot: SavedSnapshot, changes: PendingSave[]): SavedState {
  const known = new Map(previous?.items.map((item) => [item.id, item]) ?? []);
  for (const change of changes) known.set(change.item.id, { ...change.item, savedAt: change.savedAt });
  return {
    ...snapshot,
    items: snapshot.bookmarks.flatMap((row) => {
      const item = known.get(row.itemId);
      return item ? [{ ...item, savedAt: row.savedAt }] : [];
    }),
  };
}
