"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check, X, Bookmark, AlertCircle } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Card } from "@/components/ui";
import type { SavedState } from "@/lib/saved-types";
import type { ContentItem } from "@/lib/types";
import { optimisticSavedState, reconcileSavedState, type PendingSave } from "@/lib/saved-state";

type Notice = { key: string; error?: boolean; limit?: boolean };
type SavedContextValue = {
  state: SavedState | null;
  loading: boolean;
  error: boolean;
  pending: Set<string>;
  refresh: () => Promise<SavedState | null>;
  isSaved: (itemId: string) => boolean;
  toggle: (item: ContentItem) => Promise<void>;
};
const SavedContext = React.createContext<SavedContextValue | null>(null);
const SYNC_KEY = "atlas:saved:changed";
const EMPTY_SAVED_CONTEXT: SavedContextValue = {
  state: null, loading: true, error: false, pending: new Set(),
  refresh: async () => null, isSaved: () => false, toggle: async () => {},
};
type SavedStoreSnapshot = { identity: string; value: SavedContextValue };

export function SavedItemsProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const identity = status === "authenticated" ? (session?.user?.email || "authenticated") : status;
  const [snapshot, setSnapshot] = React.useState<SavedStoreSnapshot | null>(null);
  // Reset only the private controller. Keeping children mounted preserves the feed
  // and playback when the initial session resolves or the account changes.
  return <>
    <SavedStore key={identity} identity={identity} authenticated={status === "authenticated"} onChange={setSnapshot} />
    <SavedContext.Provider value={snapshot?.identity === identity ? snapshot.value : EMPTY_SAVED_CONTEXT}>
      {children}
    </SavedContext.Provider>
  </>;
}

function SavedStore({ authenticated, identity, onChange }: {
  authenticated: boolean; identity: string; onChange: (snapshot: SavedStoreSnapshot) => void;
}) {
  const { lang, t } = useLanguage();
  const [state, setState] = React.useState<SavedState | null>(null);
  const stateRef = React.useRef<SavedState | null>(null);
  const [loading, setLoading] = React.useState(authenticated);
  const [error, setError] = React.useState(false);
  const [pending, setPending] = React.useState(new Set<string>());
  const pendingRef = React.useRef(new Map<string, PendingSave>());
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const active = React.useRef(true);
  const version = React.useRef(0);
  const queue = React.useRef(Promise.resolve());
  const inFlightRefresh = React.useRef<Promise<SavedState | null> | null>(null);
  const needsRefresh = React.useRef(false);

  const publish = React.useCallback(() => {
    setState(optimisticSavedState(stateRef.current, [...pendingRef.current.values()]));
    setPending(new Set(pendingRef.current.keys()));
  }, []);

  const refresh = React.useCallback((): Promise<SavedState | null> => {
    if (!authenticated || pendingRef.current.size) return Promise.resolve(stateRef.current);
    if (inFlightRefresh.current) return inFlightRefresh.current;
    const requestVersion = ++version.current;
    const request = (async () => {
      try {
        const response = await fetch("/api/saved", { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("SAVED_UNAVAILABLE");
        const data: SavedState = await response.json();
        if (active.current && requestVersion === version.current) {
          stateRef.current = data;
          publish();
          setError(false);
        }
        return data;
      } catch {
        if (active.current && requestVersion === version.current) setError(true);
        return null;
      } finally {
        if (active.current && requestVersion === version.current) setLoading(false);
      }
    })();
    inFlightRefresh.current = request;
    void request.finally(() => {
      if (inFlightRefresh.current === request) inFlightRefresh.current = null;
    });
    return request;
  }, [authenticated, publish]);

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
      inFlightRefresh.current = null;
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

  const toggle = React.useCallback(async (item: ContentItem) => {
    const itemId = item.id;
    if (!authenticated || pendingRef.current.has(itemId)) return;
    const wasSaved = stateRef.current?.bookmarks.some((row) => row.itemId === itemId) ?? false;
    const change: PendingSave = { item, saved: !wasSaved, savedAt: new Date().toISOString() };
    pendingRef.current.set(itemId, change);
    // Immediate feedback: icons, counts and the collection change before any network work.
    publish();

    // All pending changes stay visible while requests commit in order.
    const work = queue.current.then(async () => {
      if (!active.current) return;
      try {
        const response = await fetch(`/api/saved/${encodeURIComponent(itemId)}?compact=1`, {
          method: wasSaved ? "DELETE" : "PUT",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (!active.current) return;
        if (!response.ok) {
          const key = data.code === "SAVE_LIMIT_REACHED" ? "savedLimitReached"
            : data.code === "ITEM_NOT_FOUND" ? "savedItemGone"
            : data.code === "UNAUTHORIZED" ? "savedSignIn" : "savedActionError";
          setNotice({ key, error: true, limit: data.code === "SAVE_LIMIT_REACHED" });
          needsRefresh.current = true;
        } else {
          ++version.current;
          inFlightRefresh.current = null;
          stateRef.current = reconcileSavedState(stateRef.current, data, [...pendingRef.current.values()]);
          setError(false);
          setNotice({ key: wasSaved ? "savedRemoved" : "savedAdded" });
        }
        // No saved content or user identity is persisted in browser storage.
        try { localStorage.setItem(SYNC_KEY, `${Date.now()}-${Math.random()}`); } catch { /* Optional tab sync. */ }
      } catch {
        if (active.current) setNotice({ key: "savedActionError", error: true });
        needsRefresh.current = true;
      } finally {
        pendingRef.current.delete(itemId);
        if (active.current) {
          publish();
          setLoading(false);
          // Successful saves need no full-list reload. Reconcile failures or other-device saves only.
          const missingContent = stateRef.current && stateRef.current.items.length < stateRef.current.count;
          if (!pendingRef.current.size && (needsRefresh.current || missingContent || !stateRef.current)) {
            needsRefresh.current = false;
            inFlightRefresh.current = null;
            void refresh();
          }
        }
      }
    });
    queue.current = work.catch(() => {});
    await work;
  }, [authenticated, publish, refresh]);

  const isSaved = React.useCallback((itemId: string) => pendingRef.current.get(itemId)?.saved
    ?? state?.bookmarks.some((row) => row.itemId === itemId) ?? false, [state]);
  const value = React.useMemo(() => ({ state, loading, error, pending, isSaved, refresh, toggle }),
    [state, loading, error, pending, isSaved, refresh, toggle]);
  React.useEffect(() => { onChange({ identity, value }); }, [identity, value, onChange]);

  return (
    <>
      {notice ? (
        <Card className="fixed bottom-5 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 border-[hsl(var(--border))] bg-solid-surface p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            {notice.error ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /> : <Check size={18} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />}
            <div className="min-w-0 flex-1">
              <p role={notice.error ? "alert" : "status"} className="text-sm">{t(lang, notice.key)}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <Link href="/saved" onClick={() => setNotice(null)} className="inline-flex items-center gap-1.5 underline underline-offset-4 focus-ring"><Bookmark size={13} />{t(lang, "savedTitle")}</Link>
                {notice.limit && state?.plan === "free" ? <Link href="/pricing" onClick={() => setNotice(null)} className="underline underline-offset-4 focus-ring">{t(lang, "savedUpgrade")}</Link> : null}
              </div>
            </div>
            <button type="button" onClick={() => setNotice(null)} aria-label={t(lang, "savedDismiss")} className="rounded-lg p-1 text-muted hover-subtle focus-ring"><X size={16} /></button>
          </div>
        </Card>
      ) : null}
    </>
  );
}

export function useSavedItems() {
  const context = React.useContext(SavedContext);
  if (!context) throw new Error("useSavedItems must be used within SavedItemsProvider");
  return context;
}
