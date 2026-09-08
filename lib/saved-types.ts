import type { ContentItem } from "@/lib/types";

export type SavedContentItem = ContentItem & { savedAt: string };
export type SavedState = {
  items: SavedContentItem[];
  count: number;
  limit: number;
  remaining: number;
  plan: "free" | "paid";
};

export type SavedErrorCode = "SAVE_LIMIT_REACHED" | "ITEM_NOT_FOUND" | "UNAUTHORIZED";
