"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { useSavedItems } from "@/components/saved-provider";
import type { ContentItem } from "@/lib/types";

export function SaveButton({ item }: { item: ContentItem }) {
  const { isSaved, pending, toggle } = useSavedItems();
  const { status } = useSession();
  const { lang, t } = useLanguage();
  const router = useRouter();
  const saved = isSaved(item.id);
  const busy = pending.has(item.id);
  const label = t(lang, saved ? "savedRemove" : "savedSave");
  const Icon = saved ? BookmarkCheck : Bookmark;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={saved}
      aria-busy={busy}
      title={label}
      disabled={busy || status === "loading"}
      onClick={() => status === "authenticated" ? void toggle(item) : router.push("/saved")}
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition focus-ring disabled:cursor-wait ${saved ? "border-[hsl(var(--accent)/.35)] bg-glass text-[hsl(var(--accent))]" : "border-transparent text-muted hover-subtle hover:border-[hsl(var(--border))]"}`}
    >
      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
      {busy ? <span aria-hidden="true" className="absolute right-1 top-1 h-1 w-1 animate-pulse rounded-full bg-current" /> : null}
    </button>
  );
}
