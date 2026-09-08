import { Suspense } from "react";
import type { Metadata } from "next";
import { PricingContent } from "@/components/pricing-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pricing | Atlas Assistant", description: "Compare Free and Pro, then subscribe securely with crypto on Atlas Assistant.", alternates: { canonical: "/pricing" } };

export default function PricingPage() {
  return <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-12 text-sm text-muted">Loading plans…</div>}><PricingContent /></Suspense>;
}
