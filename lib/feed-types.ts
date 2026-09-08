import type { ContentItem } from "@/lib/types";

export type FeedPayload = {
  items: ContentItem[];
  meta: {
    updatedAt: string;
    translateEnabled: boolean;
    translationAllowed: boolean;
    translationBlocked?: { error: string; upgradeRequired: boolean } | null;
  };
};
