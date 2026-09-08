"use client";

import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { useSavedItems } from "@/components/saved-provider";

export function SaveButton({ itemId }: { itemId: string }) {
  const { state, loading, pending, toggle } = useSavedItems();
  const { status } = useSession();
  const { lang, t } = useLanguage();
  const router = useRouter();
  const saved = state?.items.some((item) => item.id === itemId) ?? false;
  const busy = pending.has(itemId);
  const label = t(lang, saved ? "savedRemove" : "savedSave");
  const Icon = busy ? Loader2 : saved ? BookmarkCheck : Bookmark;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={saved}
      aria-busy={busy}
      title={label}
      disabled={busy || loading || status === "loading"}
      onClick={() => status === "authenticated" ? void toggle(itemId) : router.push("/saved")}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition focus-ring disabled:cursor-wait disabled:opacity-50 ${saved ? "border-[hsl(var(--accent)/.35)] bg-glass text-[hsl(var(--accent))]" : "border-transparent text-muted hover-subtle hover:border-[hsl(var(--border))]"}`}
    >
      <Icon size={18} strokeWidth={1.7} className={busy ? "animate-spin" : ""} aria-hidden="true" />
    </button>
  );
}
