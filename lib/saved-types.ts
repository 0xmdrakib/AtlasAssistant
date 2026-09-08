import type { ContentItem } from "@/lib/types";

export type SavedContentItem = ContentItem & { savedAt: string };
export type SavedSnapshot = {
  bookmarks: { itemId: string; savedAt: string }[];
  count: number;
  limit: number;
  remaining: number;
  plan: "free" | "paid";
};
export type SavedState = SavedSnapshot & { items: SavedContentItem[] };

export type SavedErrorCode = "SAVE_LIMIT_REACHED" | "ITEM_NOT_FOUND" | "UNAUTHORIZED";
