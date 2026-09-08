"use client";

import * as React from "react";
import { useAppConfig } from "@/components/app-config-provider";
import Link from "next/link";
import { useSavedItems } from "@/components/saved-provider";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button, Card } from "@/components/ui";
import { useLanguage } from "@/components/language-provider";

type BillingStatus = {
  ok?: boolean;
  authed?: boolean;
  plan?: "free" | "paid";
  status?: string;
  currentPeriodEnd?: string | null;
  limits?: { summary: number; digest: number; paidTranslationLanguages: number };
  remaining?: { summary: number; digest: number };
};
function periodLabel(endIso?: string | null) {
  if (!endIso) return "";
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return "";

  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end);

  if (days <= 0) return `Ends today (${date})`;
  if (days === 1) return `1 day left, ends ${date}`;
  return `${days} days left, ends ${date}`;
}

function prettyStatus(status?: string) {
  const value = String(status || "free").trim();
  if (!value) return "Free";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function UpgradeModal({
  open,
  reason,
  onClose,
}: {
  open: boolean;
  reason?: string;
  onClose: () => void;
}) {
  const { data: session, status } = useSession();
  const authed = status === "authenticated";
  const { lang, t } = useLanguage();
  const loading = false;
  const { state: saved } = useSavedItems();
  const [error, setError] = React.useState("");
  const { price } = useAppConfig();
  const priceLabel = `${price.currency.toUpperCase()} ${price.amount} / month`;
  const account = JSON.stringify([session?.user?.email || status, session?.subscription]);
  const [usage, setUsage] = React.useState<{ account: string; value: BillingStatus } | null>(null);
  const cachedUsage = React.useRef<{ account: string; value: BillingStatus; loadedAt: number } | null>(null);
  const billingStatus = { ...(usage?.account === account ? usage.value : {}), ...session?.subscription };

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    if (!authed || session?.subscription?.isOwner) return;
    if (cachedUsage.current?.account === account && Date.now() - cachedUsage.current.loadedAt < 30000) {
      setUsage(cachedUsage.current);
      return;
    }
    (async () => {
      try {
        const statusRes = await fetch("/api/billing/status", { cache: "no-store" });
        const statusData = await statusRes.json();
        if (!cancelled && statusRes.ok && statusData?.ok) {
          cachedUsage.current = { account, value: statusData, loadedAt: Date.now() };
          setUsage(cachedUsage.current);
        }
      } catch {
        if (!cancelled) setError("Usage is temporarily unavailable. Close and reopen to try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, account, authed, session?.subscription?.isOwner]);

  if (!open) return null;

  const ownerActive = authed && billingStatus?.status === "owner";
  const paidActive = authed && billingStatus?.plan === "paid";
  const active = ownerActive || paidActive;
  const activePeriod = periodLabel(billingStatus?.currentPeriodEnd);
  const planLabel = ownerActive ? "Owner" : paidActive ? "Pro" : "Free";
  const statusLabel = ownerActive ? "Owner access" : prettyStatus(billingStatus?.status);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <Card role="dialog" aria-modal="true" aria-label="Subscription and limits" className="w-full max-w-md border-[hsl(var(--border))] bg-solid-surface p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-soft bg-subtle-2">
            <Sparkles size={18} className="text-[hsl(var(--accent))]" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold">
              {ownerActive ? "Owner access active" : paidActive ? t(lang, "proActive") : t(lang, "upgradeTitle")}
            </div>
            <div className="mt-1 text-sm text-muted">
              {ownerActive
                ? "Unlimited owner access is enabled for this account."
                : paidActive
                  ? activePeriod || "Your Pro subscription is active."
                  : reason || t(lang, "upgradeBody")}
            </div>
            {!active ? <div className="mt-2 text-sm font-medium">{priceLabel}</div> : null}
          </div>
        </div>

        {error ? <div className="mt-3 rounded-xl border border-soft bg-solid-muted p-3 text-sm text-muted">{error}</div> : null}

        {authed && billingStatus ? (
          <div className="mt-4 rounded-xl border border-soft bg-solid-muted p-3 text-sm">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Current plan</span>
                <span className="font-medium">{planLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Status</span>
                <span className="font-medium">{statusLabel}</span>
              </div>
              {activePeriod ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Current period</span>
                  <span className="text-right font-medium">{activePeriod}</span>
                </div>
              ) : null}
              {ownerActive ? (
                <div className="pt-1 text-xs text-muted">Unlimited AI summaries, AI digests, and translations.</div>
              ) : (
                <>
                  <div className="border-t border-soft pt-2" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">{t(lang, "itemSummary")}</span>
                  <span className="font-medium">
                    {billingStatus?.remaining ? `${billingStatus.remaining.summary}/${billingStatus.limits?.summary} today` : "…"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">{t(lang, "digestTitle")}</span>
                  <span className="font-medium">
                    {billingStatus?.remaining ? `${billingStatus.remaining.digest}/${billingStatus.limits?.digest} today` : "…"}
                  </span>
                </div>
                <div className="text-xs text-muted">Daily limits reset at UTC midnight.</div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {authed ? <div className="mt-3 flex items-center justify-between rounded-xl border border-soft bg-solid-muted p-3 text-sm">
          <span className="text-muted">{t(lang, "savedTitle")}</span>
          <span>{saved ? `${saved.count} / ${saved.limit}` : "…"}</span>
        </div> : null}
        <Link href="/pricing" onClick={onClose} className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 py-3 text-sm font-medium text-black focus-ring">
          {active ? "View plan details" : "View plans & subscribe"}<ArrowRight size={16} />
        </Link>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={Boolean(loading)} aria-label={t(lang, "notNow")}>
            <X size={16} />
          </Button>
        </div>
      </Card>
    </div>
  );
}
