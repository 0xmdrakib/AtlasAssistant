import { Suspense } from "react";
import type { Metadata } from "next";
import { TabShell } from "@/components/tab-shell";
import { SavedContent } from "@/components/saved-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saved | Atlas Assistant", robots: { index: false, follow: false } };

export default function SavedPage() {
  return <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-10 text-sm text-muted">Loading…</div>}><TabShell><SavedContent /></TabShell></Suspense>;
}
