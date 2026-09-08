"use client";

import * as React from "react";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { Bookmark, ArrowLeft, ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";
import { useSavedItems } from "@/components/saved-provider";
import { useLanguage } from "@/components/language-provider";
import { SaveButton } from "@/components/save-button";
import { SpeakButton } from "@/components/speak-button";
import { Card, Button, Pill, A } from "@/components/ui";

export function SavedContent() {
  const { status } = useSession();
  const { state, loading, error, refresh } = useSavedItems();
  const { lang, t, speechLang } = useLanguage();
  const number = (value: number) => value.toLocaleString(lang);
  React.useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="space-y-5" aria-labelledby="saved-heading">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:underline focus-ring"><ArrowLeft size={14} />{t(lang, "savedBrowse")}</Link>
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[hsl(var(--accent)/.3)] bg-glass text-[hsl(var(--accent))]"><Bookmark size={21} strokeWidth={1.6} /></div>
            <div>
              <h1 id="saved-heading" className="text-2xl font-semibold tracking-tight">{t(lang, "savedTitle")}</h1>
              <p className="mt-1 text-xs text-muted">{t(lang, "savedSubtitle")}</p>
            </div>
          </div>
          {status === "authenticated" ? <button type="button" onClick={() => void refresh()} aria-label={t(lang, "refresh")} title={t(lang, "refresh")} className="rounded-xl p-2 text-muted hover-subtle focus-ring"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button> : null}
        </div>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted">{t(lang, "savedRetention")}</p>
        {state ? (
          <div className="mt-5 border-t border-soft pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div><span className="font-semibold tabular-nums">{number(state.count)} / {number(state.limit)}</span><span className="ml-2 text-muted">{t(lang, "savedUsed")}</span></div>
              <Pill>{state.plan === "paid" ? "Pro" : t(lang, "savedFreePlan")}</Pill>
            </div>
            <div role="progressbar" aria-label={t(lang, "savedUsed")} aria-valuenow={Math.min(state.count, state.limit)} aria-valuemax={state.limit} aria-valuemin={0} aria-valuetext={`${state.count} / ${state.limit}`} className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle-2">
              <div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all" style={{ width: `${Math.min(100, state.count / state.limit * 100)}%` }} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">{state.count > state.limit ? t(lang, "savedDowngrade") : state.remaining === 0 ? t(lang, "savedLimitReached") : t(lang, "savedSlotHint")}</p>
            {state.plan === "free" ? <Link href="/?upgrade=pro" className="mt-4 inline-flex items-center gap-1.5 text-xs text-[hsl(var(--accent))] underline underline-offset-4 focus-ring"><Sparkles size={13} />{t(lang, "savedUpgrade")}</Link> : null}
          </div>
        ) : null}
      </Card>

      {status === "loading" || loading ? (
        <div role="status" className="space-y-3"><p className="text-sm text-muted">{t(lang, "savedLoading")}</p>{[1, 2].map((key) => <Card key={key} className="h-36 animate-pulse bg-subtle p-5" />)}</div>
      ) : status !== "authenticated" ? (
        <Card className="px-6 py-10 text-center">
          <h2 className="text-lg font-semibold">{t(lang, "savedSignIn")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t(lang, "savedPlanHint")}</p>
          <Button className="mt-5" onClick={() => signIn("google", { callbackUrl: "/saved" })}>{t(lang, "continueGoogle")}</Button>
        </Card>
      ) : null}

      {error && status === "authenticated" ? <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><p role="alert" className="text-sm text-muted">{t(lang, "savedLoadError")}</p><Button variant="ghost" onClick={() => void refresh()}>{t(lang, "savedRetry")}</Button></Card> : null}

      {!loading && state?.items.length === 0 ? <Card className="px-6 py-12 text-center">
        <Bookmark size={30} strokeWidth={1.3} className="mx-auto text-muted" />
        <h2 className="mt-4 text-lg font-semibold">{t(lang, "savedEmpty")}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{t(lang, "savedEmptyHint")}</p>
        <Link href="/" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-soft bg-solid-muted px-4 py-2 text-sm hover-subtle focus-ring">{t(lang, "savedBrowse")}<ArrowUpRight size={15} /></Link>
      </Card> : null}

      {state && state.items.length > 0 ? <div className="space-y-3" aria-label={t(lang, "savedTitle")}>
        <p className="px-1 text-xs text-muted">{t(lang, "savedNewest")}</p>
        {state.items.map((item) => <Card key={item.id} className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">{item.sourceName} <span aria-hidden="true">·</span> {new Date(item.publishedAt).toLocaleDateString(lang, { month: "short", day: "numeric" })}</p>
              <h2 className="mt-2 text-lg font-semibold leading-snug">{item.title}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <SpeakButton text={`${item.title}. ${item.summary}`} lang={speechLang} labelSpeak={t(lang, "speak")} labelStop={t(lang, "stop")} />
              <SaveButton item={item} />
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{item.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">{item.country ? <Pill>{item.country}</Pill> : null}{item.topics.slice(0, 6).map((topic) => <Pill key={topic}>{topic}</Pill>)}</div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><A href={item.url}>{t(lang, "openSource")}</A><span className="text-xs text-muted">{t(lang, "savedOn")} {new Date(item.savedAt).toLocaleDateString(lang, { month: "short", day: "numeric" })}</span></div>
        </Card>)}
      </div> : null}
    </section>
  );
}
