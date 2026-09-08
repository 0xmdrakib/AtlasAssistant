"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check, X, Bookmark, AlertCircle } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Card } from "@/components/ui";
import type { SavedState } from "@/lib/saved-types";

type Notice = { key: string; error?: boolean; limit?: boolean };
type SavedContextValue = {
  state: SavedState | null;
  loading: boolean;
  error: boolean;
  pending: Set<string>;
  refresh: () => Promise<SavedState | null>;
  toggle: (itemId: string) => Promise<void>;
};
const SavedContext = React.createContext<SavedContextValue | null>(null);
const SYNC_KEY = "atlas:saved:changed";

export function SavedItemsProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const identity = status === "authenticated" ? (session?.user?.email || "authenticated") : status;
  // Reset private data and pending work immediately when the account changes.
  return <SavedStore key={identity} authenticated={status === "authenticated"}>{children}</SavedStore>;
}

function SavedStore({ authenticated, children }: { authenticated: boolean; children: React.ReactNode }) {
  const { lang, t } = useLanguage();
  const [state, setState] = React.useState<SavedState | null>(null);
  const stateRef = React.useRef<SavedState | null>(null);
  const [loading, setLoading] = React.useState(authenticated);
  const [error, setError] = React.useState(false);
  const [pending, setPending] = React.useState(new Set<string>());
  const pendingRef = React.useRef(new Set<string>());
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const active = React.useRef(true);
  const version = React.useRef(0);
  const queue = React.useRef(Promise.resolve());

  const accept = React.useCallback((next: SavedState) => {
    stateRef.current = next;
    setState(next);
    setError(false);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!authenticated || pendingRef.current.size) return stateRef.current;
    const requestVersion = ++version.current;
    try {
      const response = await fetch("/api/saved", { cache: "no-store" });
      if (!response.ok) throw new Error("SAVED_UNAVAILABLE");
      const data: SavedState = await response.json();
      if (active.current && requestVersion === version.current) accept(data);
      return data;
    } catch {
      if (active.current && requestVersion === version.current) setError(true);
      return null;
    } finally {
      if (active.current && requestVersion === version.current) setLoading(false);
    }
  }, [authenticated, accept]);

  React.useEffect(() => {
    active.current = true;
    void refresh();
    const revalidate = () => { if (document.visibilityState === "visible") void refresh(); };
    const onStorage = (event: StorageEvent) => { if (event.key === SYNC_KEY) revalidate(); };
    const timer = window.setInterval(revalidate, 60000);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("storage", onStorage);
    return () => {
      active.current = false;
      version.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  React.useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggle = React.useCallback(async (itemId: string) => {
    if (!authenticated || pendingRef.current.has(itemId)) return;
    if (!stateRef.current) {
      const initial = await refresh();
      if (!initial) {
        setNotice({ key: "savedLoadError", error: true });
        return;
      }
      if (pendingRef.current.has(itemId) || !active.current) return;
    }
    pendingRef.current.add(itemId);
    setPending(new Set(pendingRef.current));
    ++version.current;

    // Keep responses in order when several different icons are clicked quickly.
    const work = queue.current.then(async () => {
      if (!active.current) return;
      const wasSaved = stateRef.current?.items.some((item) => item.id === itemId) ?? false;
      try {
        const response = await fetch(`/api/saved/${encodeURIComponent(itemId)}`, {
          method: wasSaved ? "DELETE" : "PUT",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        const data = await response.json();
        if (!active.current) return;
        if (!response.ok) {
          const key = data.code === "SAVE_LIMIT_REACHED" ? "savedLimitReached"
            : data.code === "ITEM_NOT_FOUND" ? "savedItemGone"
            : data.code === "UNAUTHORIZED" ? "savedSignIn" : "savedActionError";
          setNotice({ key, error: true, limit: data.code === "SAVE_LIMIT_REACHED" });
        } else {
          accept(data);
          setNotice({ key: wasSaved ? "savedRemoved" : "savedAdded" });
        }
        // No saved content or user identity is persisted in browser storage.
        try { localStorage.setItem(SYNC_KEY, `${Date.now()}-${Math.random()}`); } catch { /* Optional tab sync. */ }
      } catch {
        if (active.current) setNotice({ key: "savedActionError", error: true });
      } finally {
        pendingRef.current.delete(itemId);
        if (active.current) {
          setPending(new Set(pendingRef.current));
          setLoading(false);
          // Reconcile limit errors, ambiguous network failures and content cleanup.
          if (!pendingRef.current.size) void refresh();
        }
      }
    });
    queue.current = work.catch(() => {});
    await work;
  }, [authenticated, accept, refresh]);

  return (
    <SavedContext.Provider value={{ state, loading, error, pending, refresh, toggle }}>
      {children}
      {notice ? (
        <Card className="fixed bottom-5 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 border-[hsl(var(--border))] bg-solid-surface p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            {notice.error ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /> : <Check size={18} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />}
            <div className="min-w-0 flex-1">
              <p role={notice.error ? "alert" : "status"} className="text-sm">{t(lang, notice.key)}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <Link href="/saved" onClick={() => setNotice(null)} className="inline-flex items-center gap-1.5 underline underline-offset-4 focus-ring"><Bookmark size={13} />{t(lang, "savedTitle")}</Link>
                {notice.limit && state?.plan === "free" ? <Link href="/?upgrade=pro" onClick={() => setNotice(null)} className="underline underline-offset-4 focus-ring">{t(lang, "savedUpgrade")}</Link> : null}
              </div>
            </div>
            <button type="button" onClick={() => setNotice(null)} aria-label={t(lang, "savedDismiss")} className="rounded-lg p-1 text-muted hover-subtle focus-ring"><X size={16} /></button>
          </div>
        </Card>
      ) : null}
    </SavedContext.Provider>
  );
}

export function useSavedItems() {
  const context = React.useContext(SavedContext);
  if (!context) throw new Error("useSavedItems must be used within SavedItemsProvider");
  return context;
}
