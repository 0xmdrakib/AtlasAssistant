"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { ArrowLeft, ArrowRight, Bookmark, Check, CheckCircle2, Copy, Loader2, LockKeyhole, RefreshCw, Sparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button, Card } from "@/components/ui";
import { useAppConfig } from "@/components/app-config-provider";
import { useLanguage } from "@/components/language-provider";
import { useSavedItems } from "@/components/saved-provider";
import { isExpiredUnpaidQuote, TERMINAL_PAYMENT_STATUSES, type EmbeddedPayment, type PaymentCurrency } from "@/lib/payment-types";
import { PaymentNetworkPicker, TokenIcon } from "@/components/payment-network-picker";
import { checkoutApi as api, type CheckoutApiError } from "@/lib/checkout-client";

type Discount = { code: string; percentOff: number; price: { finalAmount: string; currency: string } };

export function PricingContent() {
  const { data: session, status } = useSession();
  const { price } = useAppConfig();
  const { lang } = useLanguage();
  const bn = lang === "bn";
  const active = session?.subscription?.plan === "paid";
  // NextAuth retains the session while refreshing it after activation.
  const hasUser = Boolean(session?.user);
  const features = [
    ["Item summaries / day", "প্রতিদিন আইটেম সামারি", "5", "20"],
    ["AI digests / day", "প্রতিদিন AI ডাইজেস্ট", "3", "10"],
    ["Saved posts", "সেভ করা পোস্ট", "10", "50"],
    ["Translation languages / period", "প্রতি পেইড মেয়াদে অনুবাদের ভাষা", "—", "2"],
  ];
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
    <header className="flex items-center justify-between gap-4">
      <Link href="/" className="inline-flex items-center gap-2 rounded-lg text-sm text-muted focus-ring"><ArrowLeft size={16} />{bn ? "ফিডে ফিরে যান" : "Back to feed"}</Link>
      <span className="text-sm font-semibold">Atlas Assistant</span>
    </header>
    <section className="mb-8 mt-10 max-w-2xl">
      <span className="inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--accent))]"><Sparkles size={16} />Atlas Pro</span>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{bn ? "আরও জানুন, আরও সেভ করুন।" : "Read deeper. Save more."}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{bn ? "বেশি AI সামারি, অনুবাদ এবং আপনার পছন্দের পোস্ট রাখার আরও জায়গা—একটি সহজ মাসিক প্ল্যানে।" : "More AI summaries, translations, and room for the stories you want to keep. One simple monthly plan."}</p>
    </section>
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.05fr]">
      <div className="space-y-5">
        <Card className="overflow-hidden bg-solid-surface">
          <div className="border-b border-soft p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{bn ? "আপনার প্ল্যান বেছে নিন" : "Your plans at a glance"}</h2><span className="rounded-full bg-subtle-2 px-2.5 py-1 text-xs text-muted">{bn ? "মাসিক" : "Monthly"}</span></div>
            <div className="mt-5 flex items-baseline gap-2"><span className="text-sm text-muted">{price.currency.toUpperCase()}</span><span className="text-4xl font-semibold tracking-tight">{price.amount}</span><span className="text-sm text-muted">/ {bn ? "মাস" : "month"}</span></div>
            <p className="mt-2 text-xs leading-5 text-muted">{bn ? "প্রতিটি পেমেন্টে এক মাস Pro। অটোমেটিক চার্জ হবে না।" : "One month of Pro per payment. No automatic charges."}</p>
          </div>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Free and Pro plan comparison</caption>
            <thead><tr className="border-b border-soft text-xs text-muted"><th className="px-5 py-4 font-normal">{bn ? "সুবিধা" : "Included"}</th><th className="px-2 py-4 text-center font-normal">Free</th><th className="px-5 py-4 text-center font-semibold text-[hsl(var(--fg))]">Pro</th></tr></thead>
            <tbody>{features.map(([en, bangla, free, pro]) => <tr key={en} className="border-b border-soft last:border-0"><th scope="row" className="px-5 py-4 text-xs font-normal sm:text-sm">{bn ? bangla : en}</th><td className="px-2 py-4 text-center text-muted">{free}</td><td className="px-5 py-4 text-center font-semibold">{pro}</td></tr>)}</tbody>
          </table>
        </Card>
        <div className="space-y-3 px-1 text-xs leading-5 text-muted">
          <p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0" />{bn ? "দৈনিক সীমা UTC মধ্যরাতে রিসেট হয়। ক্যাশে থাকা AI ফলাফলে কোটা খরচ হয় না।" : "Daily limits reset at UTC midnight. Cached AI results do not use your quota."}</p>
          <p className="flex gap-2"><Bookmark size={15} className="mt-0.5 shrink-0" />{bn ? "আসল পোস্ট থাকা পর্যন্ত সেভ থাকবে। পোস্ট বা সেভ মুছলে জায়গা আবার খালি হবে।" : "Saves stay while the original post exists. Removing a save or its original frees the slot automatically."}</p>
        </div>
      </div>
      {status === "loading" && !hasUser ? <Card className="bg-solid-surface p-6"><h2 className="text-lg font-semibold">{bn ? "নিরাপদ চেকআউট" : "Secure checkout"}</h2><p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />{bn ? "অ্যাকাউন্ট লোড হচ্ছে…" : "Loading your account…"}</p></Card>
        : <Checkout key={session?.user?.email || "guest"} authed={Boolean(session?.user)} active={Boolean(active)} />}
    </div>
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-soft pt-5 text-xs text-muted">
      <a href="mailto:0xmdrakib@gmail.com" className="focus-ring">{bn ? "বিলিং সহায়তা" : "Billing support"}</a>
      <div className="flex flex-wrap gap-4"><Link href="/terms-and-conditions">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refund">Refund policy</Link></div>
    </footer>
  </main>;
}

function Checkout({ authed, active }: { authed: boolean; active: boolean }) {
  const { data: session, update } = useSession();
  const { refresh: refreshSaved } = useSavedItems();
  const { price } = useAppConfig();
  const { lang } = useLanguage();
  const bn = lang === "bn";
  const searchParams = useSearchParams();
  const initialId = React.useRef(searchParams.get("payment"));
  const [payment, setPayment] = React.useState<EmbeddedPayment | null>(null);
  const [currencies, setCurrencies] = React.useState<PaymentCurrency[]>([]);
  const [selected, setSelected] = React.useState("");
  const [networksLoading, setNetworksLoading] = React.useState(authed && !active);
  const [restoring, setRestoring] = React.useState(authed);
  const [networkError, setNetworkError] = React.useState("");
  const [error, setError] = React.useState("");
  const [pollError, setPollError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [code, setCode] = React.useState("");
  const [discount, setDiscount] = React.useState<Discount | null>(null);
  const [copied, setCopied] = React.useState("");
  const [now, setNow] = React.useState(Date.now());
  const requestId = React.useRef<string | null>(null);
  const live = React.useRef(true);
  const polling = React.useRef(false);
  const activated = React.useRef<string | null>(null);
  const initialized = React.useRef(false);
  const amount = discount?.price.finalAmount || price.amount;
  const availableCurrencies = React.useMemo(() => currencies.filter((currency) => typeof currency.minimum === "number" && Number(amount) + 0.000001 >= currency.minimum), [currencies, amount]);

  React.useEffect(() => {
    if (selected && !availableCurrencies.some((currency) => currency.code === selected)) { setSelected(""); requestId.current = null; }
  }, [availableCurrencies, selected]);

  const remember = React.useCallback((next: EmbeddedPayment | null) => {
    setPayment(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("payment", next.id); else url.searchParams.delete("payment");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  const loadNetworks = React.useCallback(async () => {
    setNetworksLoading(true); setNetworkError("");
    try {
      const data = await api("/api/billing/currencies");
      if (!live.current) return;
      setCurrencies(data.currencies);
      // Keep network selection explicit so the wallet network is never assumed.
    } catch (e) { if (live.current) setNetworkError((e as Error).message); }
    finally { if (live.current) setNetworksLoading(false); }
  }, []);

  React.useEffect(() => {
    live.current = true;
    if (authed && !initialized.current) {
      initialized.current = true;
      if (!active) void loadNetworks();
      const id = initialId.current;
      void api(id ? `/api/billing/payments/${encodeURIComponent(id)}` : "/api/billing/payments/current")
        .then((data) => {
          if (!live.current) return;
          // An old payment link must not pin a verified expired, unpaid quote.
          remember(data.payment && !isExpiredUnpaidQuote(data.payment) ? data.payment : null);
        })
        .catch((e) => { if (live.current) setError((e as Error).message); })
        .finally(() => { if (live.current) setRestoring(false); });
    } else if (!authed) setRestoring(false);
    return () => { live.current = false; };
  }, [authed, active, loadNetworks, remember]);

  const checkPayment = React.useCallback(async (id: string) => {
    if (polling.current) return;
    polling.current = true;
    try {
      const data = await api(`/api/billing/payments/${encodeURIComponent(id)}`);
      if (!live.current) return;
      setPayment((current) => current?.id === id ? data.payment : current);
      setPollError("");
    } catch (e) { if (live.current) setPollError((e as Error).message); }
    finally { polling.current = false; }
  }, []);

  React.useEffect(() => {
    if (!payment || payment.activatedAt || (TERMINAL_PAYMENT_STATUSES.has(payment.status) && payment.status !== "finished")) return;
    const id = payment.id;
    const tick = () => { if (document.visibilityState === "visible") void checkPayment(id); };
    const timer = window.setInterval(tick, 8000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [payment?.id, payment?.status, payment?.activatedAt, checkPayment]);

  React.useEffect(() => {
    if (!payment?.activatedAt || activated.current === payment.id) return;
    activated.current = payment.id;
    void update().catch(() => {});
    void refreshSaved();
  }, [payment, update, refreshSaved]);

  React.useEffect(() => {
    if (!payment?.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payment?.expiresAt]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(value: string, name: string) {
    try { await navigator.clipboard.writeText(value); setCopied(name); }
    catch { setError("Could not copy automatically. Select and copy the value instead."); }
  }

  async function applyDiscount() {
    if (!code.trim()) return;
    setBusy("discount"); setError("");
    try {
      const data = await api("/api/billing/discount", { code: code.trim() });
      if (live.current) { setDiscount(data); setCode(data.code); requestId.current = null; }
    } catch (e) { if (live.current) { setDiscount(null); setError((e as Error).message); } }
    finally { if (live.current) setBusy(""); }
  }

  async function createPayment() {
    if (busy || restoring) return;
    const free = discount?.percentOff === 100;
    if (!free && !selected) return;
    setBusy("create"); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const data = await api(`/api/billing/checkout/${free ? "free" : "crypto"}`, { requestId: requestId.current, payCurrency: selected, discountCode: discount?.code });
      if (live.current) remember(data.payment);
    } catch (e) {
      if (!live.current) return;
      setError((e as Error).message);
      // A transport timeout may have committed. Reuse its key when retrying.
      if ((e as CheckoutApiError).definitiveFailure) requestId.current = null;
    } finally { if (live.current) setBusy(""); }
  }

  function startOver() {
    remember(null); requestId.current = null; setError(""); setPollError("");
    setDiscount(null); setCode(""); setSelected("");
    if (!currencies.length && !active) void loadNetworks();
  }

  const complete = Boolean(payment?.activatedAt && payment.status !== "refunded");
  const expiredQuote = Boolean(payment?.expiresAt && Date.parse(payment.expiresAt) <= now);
  const canSend = payment?.status === "waiting" && !expiredQuote;
  const terminal = payment ? TERMINAL_PAYMENT_STATUSES.has(payment.status) : false;
  const asset = payment?.payCurrency?.toUpperCase().match(/^(USDT|USDC)/)?.[0] || payment?.payCurrency?.toUpperCase() || "Crypto";
  const statusLabels: Record<string, string> = { creating: "Preparing payment", waiting: "Awaiting payment", confirming: "Confirming on the network", confirmed: "Transfer confirmed · finalizing", sending: "Finalizing payment", partially_paid: "Partial payment received", finished: "Payment complete", expired: "Payment expired", failed: "Payment failed", refunded: "Payment refunded" };
  const statusLabel = payment ? expiredQuote && payment.status === "waiting" ? "Quote expired" : statusLabels[payment.status] || "Checking payment" : "";

  return <Card id="checkout" className="min-w-0 overflow-hidden border-[hsl(var(--accent)/.35)] bg-solid-surface shadow-xl">
    <div className="flex items-start justify-between gap-3 border-b border-soft p-5 sm:p-6">
      <div><h2 className="text-lg font-semibold">{complete ? (bn ? "Pro চালু হয়েছে" : "You’re on Pro") : payment ? (bn ? "আপনার পেমেন্ট" : "Your payment") : active ? (bn ? "আপনার প্ল্যান চালু আছে" : "Your plan is active") : (bn ? "নিরাপদ চেকআউট" : "Secure checkout")}</h2>
        <p className="mt-1 text-xs leading-5 text-muted">{complete ? "Payment received and access activated." : "Powered by NOWPayments"}</p></div>
      {complete || active && !payment ? <CheckCircle2 className="shrink-0 text-[hsl(var(--accent))]" size={22} /> : <LockKeyhole size={20} className="shrink-0 text-muted" />}
    </div>
    <div className="space-y-5 p-5 sm:p-6">
      {error ? <p role="alert" className="rounded-xl border border-soft bg-solid-muted p-3 text-sm leading-5">{error}</p> : null}
      {authed && restoring ? <p role="status" className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" />{bn ? "আগের পেমেন্ট যাচাই হচ্ছে…" : "Checking for an existing payment…"}</p> : null}
      {!authed ? <>
        <p className="text-sm leading-6 text-muted">{bn ? "আপনার অ্যাকাউন্টে Pro যোগ করতে আগে সাইন ইন করুন।" : "Sign in so we can add Pro to your account after payment."}</p>
        <Button className="w-full gap-2 py-3" onClick={() => signIn("google", { callbackUrl: `/pricing${window.location.search}` })}>{bn ? "Google দিয়ে সাইন ইন" : "Continue with Google"}<ArrowRight size={16} /></Button>
      </> : complete ? <div className="space-y-4">
        <div role="status" className="rounded-xl border border-[hsl(var(--accent)/.3)] bg-subtle-2 p-4"><CheckCircle2 className="mb-3 text-[hsl(var(--accent))]" size={28} /><h3 className="font-semibold">{bn ? "পেমেন্ট সম্পূর্ণ হয়েছে" : "Payment complete"}</h3><p className="mt-2 text-sm leading-6 text-muted">{bn ? "আপনার Pro সুবিধাগুলো এখন ব্যবহার করতে পারবেন।" : "Your Pro benefits are ready, including 50 saved posts and higher daily AI limits."}</p></div>
        <Link href="/" className="flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 py-3 text-sm font-medium text-black focus-ring">{bn ? "পড়া শুরু করুন" : "Continue reading"}<ArrowRight size={16} /></Link>
      </div> : payment ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 font-semibold"><TokenIcon asset={asset} />{asset} · {payment.network || payment.payCurrency}</span><span role="status" className="rounded-full border border-soft bg-solid-muted px-3 py-1 text-xs">{statusLabel}</span></div>
        {canSend && payment.payAddress && payment.payAmount ? <>
          <div className="flex justify-center rounded-xl border border-soft bg-white p-5"><QRCodeSVG value={payment.payAddress} size={180} marginSize={3} level="M" role="img" aria-label="Payment address QR code" title="Payment address QR code" /></div>
          <PaymentField label={`Send exactly (${asset})`} value={payment.payAmount} copied={copied === "amount"} onCopy={() => void copy(payment.payAmount!, "amount")} />
          <PaymentField label="Payment address" value={payment.payAddress} copied={copied === "address"} onCopy={() => void copy(payment.payAddress!, "address")} />
          {payment.payinExtraId ? <PaymentField label="Required memo / destination tag" value={payment.payinExtraId} copied={copied === "memo"} onCopy={() => void copy(payment.payinExtraId!, "memo")} /> : null}
          <p className="rounded-xl bg-solid-muted p-3 text-xs leading-5">Send only <strong>{asset}</strong> on <strong>{payment.network}</strong>. The QR contains the address; enter the exact amount{payment.payinExtraId ? " and required memo" : ""} in your wallet.</p>
          <p className="text-xs leading-5 text-muted">Send the exact amount shown. Your wallet may charge a separate network fee.</p>
        </> : <div className="rounded-xl border border-soft bg-solid-muted p-4 text-sm leading-6">
          {payment.status === "partially_paid" ? "Only part of the payment was received. Contact billing support with your payment ID before sending more." : expiredQuote && payment.status === "waiting" ? "This quote has expired. Check the payment status before creating a new checkout." : terminal ? "This payment is not complete. If you already sent funds, contact billing support before trying again." : "We’re checking your payment. You can keep this page open; Pro will activate here once payment is complete."}
        </div>}
        {payment.expiresAt && canSend ? <p className="text-xs text-muted">Quote valid until {new Date(payment.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p> : null}
        {pollError ? <p role="alert" className="text-xs leading-5 text-muted">{pollError} Your payment details are kept. Check again in a moment.</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="gap-2 text-xs" onClick={() => void checkPayment(payment.id)}><RefreshCw size={14} />Check payment status</Button>
          {terminal || payment.status === "waiting" || payment.status === "creating" ? <button className="rounded-lg text-xs text-muted underline underline-offset-4 focus-ring" onClick={startOver}>{terminal ? "Start a new checkout" : "Choose another network"}</button> : null}
        </div>
        <p className="break-all text-xs text-muted">Payment ID: <span className="select-all">{payment.id}</span></p>
      </> : active ? <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{session?.subscription?.isOwner ? "Unlimited owner access is enabled for your account." : `Pro access is active${session?.subscription?.currentPeriodEnd ? ` until ${new Date(session.subscription.currentPeriodEnd).toLocaleDateString()}` : ""}.`}</p>
        <Link href="/" className="inline-flex items-center gap-2 text-sm underline underline-offset-4">Continue reading<ArrowRight size={15} /></Link>
      </div> : <>
        <p className="text-sm leading-6 text-muted">{bn ? "আপনার ওয়ালেটের সঠিক নেটওয়ার্ক বেছে নিন। এখানেই পেমেন্টের ঠিকানা ও QR দেখানো হবে।" : "Choose the network you’ll use in your wallet. Your payment address and QR code will appear here."}</p>
        <div className="space-y-2"><div className="text-sm font-medium">{bn ? "কয়েন ও নেটওয়ার্ক" : "Coin & network"}</div>
          {discount?.percentOff === 100 ? <p className="text-sm text-muted">Your code covers the full price. No payment is needed.</p> : networksLoading ? <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted"><Loader2 size={16} className="animate-spin" />Loading available networks…</p> : networkError ? <div className="space-y-2"><p role="alert" className="text-sm text-muted">{networkError}</p><Button variant="ghost" onClick={() => void loadNetworks()}>Retry networks</Button></div> : availableCurrencies.length ? <><PaymentNetworkPicker currencies={availableCurrencies} value={selected} disabled={Boolean(busy)} label={bn ? "কয়েন ও নেটওয়ার্ক" : "Coin & network"} placeholder={bn ? "নেটওয়ার্ক বেছে নিন" : "Select a network"} onChange={(value) => { setSelected(value); requestId.current = null; setError(""); }} /><p className="text-xs text-muted">Only networks supporting {price.currency.toUpperCase()} {amount} are shown.</p></> : <div role="status" className="space-y-2 rounded-xl border border-soft bg-solid-muted p-3"><p className="text-sm leading-6">No payment networks currently support {price.currency.toUpperCase()} {amount}{discount ? " with this discount. Remove the code to see available networks." : ". Please try again later or contact billing support."}</p><Button variant="ghost" onClick={() => void loadNetworks()}>Refresh networks</Button></div>}
        </div>
        <div className="space-y-2"><label htmlFor="discount-code" className="text-xs text-muted">{bn ? "ডিসকাউন্ট কোড (যদি থাকে)" : "Discount code (optional)"}</label><div className="flex gap-2"><input id="discount-code" value={code} maxLength={80} autoComplete="off" disabled={Boolean(busy)} onChange={(event) => { setCode(event.target.value.toUpperCase()); setDiscount(null); requestId.current = null; }} className="min-w-0 flex-1 rounded-xl border border-soft bg-solid-muted px-3 py-2 text-sm focus-ring" placeholder="Enter code" /><Button variant="ghost" disabled={!code.trim() || Boolean(busy)} onClick={() => void applyDiscount()}>{busy === "discount" ? <Loader2 size={16} className="animate-spin" /> : "Apply"}</Button></div>
          {discount ? <p role="status" className="text-xs text-[hsl(var(--accent))]">{discount.percentOff}% off applied · {discount.code}</p> : null}
        </div>
        <div className="flex items-center justify-between border-t border-soft pt-4 text-sm"><span className="text-muted">Pro · 1 month</span><span className="font-semibold">{price.currency.toUpperCase()} {amount}</span></div>
        <Button className="w-full gap-2 py-3" disabled={Boolean(busy) || restoring || (!selected && discount?.percentOff !== 100)} onClick={() => void createPayment()}>{busy === "create" ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}{busy === "create" ? "Preparing checkout…" : discount?.percentOff === 100 ? "Activate free Pro" : "Show payment details"}</Button>
        <p className="text-center text-xs leading-5 text-muted">{bn ? "সম্পূর্ণ পেমেন্ট নিশ্চিত হলে Pro স্বয়ংক্রিয়ভাবে চালু হবে।" : "Pro activates automatically after full payment confirmation."}</p>
      </>}
    </div>
  </Card>;
}

function PaymentField({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return <div className="rounded-xl border border-soft bg-solid-muted p-3"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-muted">{label}</span><button type="button" onClick={onCopy} className="rounded-lg p-1 focus-ring" aria-label={`Copy ${label}`} title={copied ? "Copied" : "Copy"}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><code className="block select-all break-all text-sm leading-6">{value}</code></div>;
}
