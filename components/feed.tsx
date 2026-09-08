"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Section } from "@/lib/types";
import { Card, Pill, Button, A, Segmented } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { signIn, useSession } from "next-auth/react";
import { useLanguage } from "@/components/language-provider";
import { SpeakButton } from "@/components/speak-button";
import { UpgradeModal } from "@/components/upgrade-modal";
import { SaveButton } from "@/components/save-button";

import { useAppConfig } from "@/components/app-config-provider";
import type { FeedPayload } from "@/lib/feed-types";
import { cachedFeed, feedCacheKey, FEED_CACHE_MS, requestFeed, storeFeed } from "@/lib/feed-cache";

type Days = 1 | 7;
type DigestOutput = {
  overview: string;
  themes: string[];
  highlights: string[];
  whyItMatters: string[];
  watchlist: string[];
};

function extractKeyPointsFromSummary(summary: string): string[] {
  const s = String(summary || "");
  if (!s) return [];

  // Expect the model to keep the English section label "Key points:".
  const start = s.toLowerCase().indexOf("key points:");
  if (start < 0) return [];
  const after = s.slice(start + "key points:".length);

  // Stop at the next known section.
  const stopCandidates = ["\ncontext:", "\nwhy it matters:", "\ntldr:"];
  let end = after.length;
  for (const m of stopCandidates) {
    const idx = after.toLowerCase().indexOf(m);
    if (idx >= 0) end = Math.min(end, idx);
  }
  const block = after.slice(0, end);

  return block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\d+\s*[\).:-]\s*/, ""))
    .filter((l) => l.length >= 8)
    .slice(0, 8);
}

function stripKeyPointsFromSummary(summary: string): string {
  const s = String(summary || "");
  if (!s) return "";

  const label = "key points:";
  const lower = s.toLowerCase();
  const start = lower.indexOf(label);
  if (start < 0) return s.trim();

  // Find the start of the next section after Key points.
  const afterStart = start + label.length;
  const tail = s.slice(afterStart);
  const tailLower = tail.toLowerCase();

  // Prefer Context/Why it matters if present.
  const stopMarkers = ["\ncontext:", "\nwhy it matters:", "\ntldr:"];
  let stop = tail.length;
  for (const m of stopMarkers) {
    const j = tailLower.indexOf(m);
    if (j >= 0) stop = Math.min(stop, j);
  }

  const before = s.slice(0, start).trimEnd();
  const afterText = tail.slice(stop).trimStart();
  const out = [before, afterText].filter(Boolean).join("\n");
  return out.trim();
}

export function Feed({ section, initialData }: { section: Section; initialData?: FeedPayload }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const authed = status === "authenticated";
  const { lang, t, speechLang, ready } = useLanguage();


  const [country, setCountry] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [days, setDays] = React.useState<Days>(1);

  const [aiOpen, setAiOpen] = React.useState<Record<string, boolean>>({});
  const [aiLoading, setAiLoading] = React.useState<Record<string, boolean>>({});

  const { summaryEnabled: aiSummaryEnabled } = useAppConfig();
  const account = JSON.stringify([session?.user?.email || status, session?.subscription]);
  const key = feedCacheKey(section, days, lang, account);
  const initialKey = feedCacheKey(section, 1, "en", "public");
  const [feed, setFeed] = React.useState<{ key: string; data: FeedPayload } | null>(
    initialData ? { key: initialKey, data: initialData } : null
  );
  const visible = feed?.key === key ? feed.data : days === 1 ? initialData : undefined;
  const items = React.useMemo(() => (visible?.items || []).filter((item) =>
    (!country.trim() || item.country?.toLowerCase().includes(country.trim().toLowerCase())) &&
    (!topic.trim() || item.topics.some((value) => value.toLowerCase().includes(topic.trim().toLowerCase())))
  ), [visible, country, topic]);
  const [feedLoading, setFeedLoading] = React.useState(!initialData);
  const [feedError, setFeedError] = React.useState(false);
  const requestVersion = React.useRef(0);
  const activeKey = React.useRef(key);
  activeKey.current = key;

  const [digestOpen, setDigestOpen] = React.useState(false);
  const [digestLoading, setDigestLoading] = React.useState(false);
  const [digest, setDigest] = React.useState<DigestOutput | null>(null);
  const [digestError, setDigestError] = React.useState<string>("");

  const last = visible?.meta.updatedAt || "";
  const [msg, setMsg] = React.useState<string>("");
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const [upgradeReason, setUpgradeReason] = React.useState("");

  function requireLogin(): boolean {
    if (authed) return true;
    setLoginOpen(true);
    return false;
  }

  const showUpgrade = React.useCallback(
    (reason?: string) => {
      setUpgradeReason(reason || t(lang, "subscriptionRequired"));
      setUpgradeOpen(true);

      const params = new URLSearchParams(searchParams.toString());
      if (params.get("upgrade") !== "pro") {
        params.set("upgrade", "pro");
        window.history.replaceState(null, "", `${pathname}?${params.toString()}${window.location.hash}`);
      }
    },
    [lang, pathname, searchParams, t]
  );

  function closeUpgrade() {
    setUpgradeOpen(false);
    setUpgradeReason("");

    const params = new URLSearchParams(searchParams.toString());
    if (params.get("upgrade") === "pro") {
      params.delete("upgrade");
      const qs = params.toString();
      window.history.replaceState(null, "", `${qs ? `${pathname}?${qs}` : pathname}${window.location.hash}`);
    }
  }

  React.useEffect(() => {
    if (searchParams.get("upgrade") !== "pro") {
      setUpgradeOpen(false);
      return;
    }

    let pendingReason = "";
    try {
      pendingReason = sessionStorage.getItem("atlas:upgradeReason") || "";
      if (pendingReason) sessionStorage.removeItem("atlas:upgradeReason");
    } catch {
      pendingReason = "";
    }

    setUpgradeReason((current) => current || pendingReason || t(lang, "upgradeBody"));
    setUpgradeOpen(true);
  }, [lang, searchParams, t]);

  React.useEffect(() => {
    if (!ready || (lang !== "en" && status === "loading")) return;
    const version = ++requestVersion.current;
    if (initialData) {
      const previous = cachedFeed(initialKey);
      const loadedAt = Date.parse(initialData.meta.updatedAt);
      if (!previous || loadedAt > Date.parse(previous.data.meta.updatedAt)) storeFeed(initialKey, initialData, loadedAt);
    }
    const cached = cachedFeed(key);
    if (cached) setFeed({ key, data: cached.data });
    setFeedError(false);
    if (cached && Date.now() - cached.receivedAt < FEED_CACHE_MS) {
      setFeedLoading(false);
      return;
    }
    setFeedLoading(true);
    void requestFeed(key, section, days, lang).then((data) => {
      if (version === requestVersion.current && activeKey.current === key) setFeed({ key, data });
    }).catch(() => {
      if (version === requestVersion.current && activeKey.current === key) setFeedError(true);
    }).finally(() => {
      if (version === requestVersion.current && activeKey.current === key) setFeedLoading(false);
    });
    return () => { ++requestVersion.current; };
  }, [key, initialKey, initialData, ready, section, days, lang, status === "loading"]);

  async function refreshFeed() {
    const version = ++requestVersion.current;
    setFeedLoading(true);
    setFeedError(false);
    try {
      const data = await requestFeed(key, section, days, lang, true);
      if (version === requestVersion.current && activeKey.current === key) setFeed({ key, data });
    } catch {
      if (version === requestVersion.current && activeKey.current === key) setFeedError(true);
    } finally {
      if (version === requestVersion.current && activeKey.current === key) setFeedLoading(false);
    }
  }

  React.useEffect(() => {
    setDigestOpen(false);
    setDigest(null);
    setDigestError("");
  }, [section, country, topic, days, lang]);

  async function ensureDigest() {
    if (!aiSummaryEnabled) return;
    if (!requireLogin()) return;
    if (digest) return;

    setDigestLoading(true);
    setDigestError("");

    try {
      const res = await fetch(`/api/ai/digest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section, days, country: country || null, topic: topic || null, lang }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j?.upgradeRequired) {
          showUpgrade(j?.error || t(lang, "subscriptionRequired"));
          return;
        }
        throw new Error(j?.error || `Digest failed (${res.status})`);
      }
      setDigest(j?.digest || null);
    } catch (e: any) {
      setDigestError(e?.message || "Digest failed");
    } finally {
      setDigestLoading(false);
    }
  }

  async function ensureAiSummary(id: string) {
    if (!aiSummaryEnabled) return;
    if (!requireLogin()) return;

    setAiLoading((x) => ({ ...x, [id]: true }));
    try {
      const res = await fetch(`/api/ai/summary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, lang }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j?.upgradeRequired) {
          showUpgrade(j?.error || t(lang, "subscriptionRequired"));
          return;
        }
        throw new Error(j?.error || `Summary failed (${res.status})`);
      }

      // The mutation returns the summary: update this post without reloading the feed.
      if (typeof j.aiSummary === "string" && activeKey.current === key) {
        const current = cachedFeed(key)?.data || visible;
        if (current) {
          const data = { ...current, items: current.items.map((item) => item.id === id ? { ...item, aiSummary: j.aiSummary } : item) };
          storeFeed(key, data);
          setFeed({ key, data });
        }
      }
    } catch (e: any) {
      setMsg(e?.message || "Summary failed");
    } finally {
      setAiLoading((x) => ({ ...x, [id]: false }));
    }
  }

  const digestSpeakText = digest
    ? [
        digest.overview,
        ...digest.themes,
        ...digest.highlights,
        ...digest.whyItMatters,
        ...digest.watchlist,
      ].join("\n")
    : "";

  // If a translation key is missing, our i18n helper may return the key itself.
  // Harden this specific Controls hint so raw keys never leak into the UI.
  const controlsHintBaseRaw = t(lang, "controlsHintBase");
  const controlsHintBase =
    controlsHintBaseRaw === "controlsHintBase"
      ? lang === "bn"
        ? "Country + category + window • স্কোরিং + ক্যাপস দিয়ে কিউরেটেড"
        : "Country + category + window • curated by scoring + caps"
      : controlsHintBaseRaw;
  const updatesKey = "updatesEvery1h";
  const updatesHintRaw = t(lang, "updatesEvery1h");
  const updatesHint =
    updatesHintRaw === updatesKey
      ? lang === "bn"
        ? "প্রতি ১ ঘণ্টায় আপডেট"
        : "updates every 1 hour"
      : updatesHintRaw;

  return (
    <div className="space-y-4">
      {loginOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <Card className="w-full max-w-md p-5">
            <div className="text-base font-semibold">{t(lang, "signInTitle")}</div>
            <div className="mt-1 text-sm text-muted">{t(lang, "signInBody")}</div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setLoginOpen(false)} aria-label={t(lang, "notNow")}>
                <X size={16} />
              </Button>
              <Button
                onClick={() => {
                  setLoginOpen(false);
                  signIn("google");
                }}
              >
                {t(lang, "continueGoogle")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <UpgradeModal open={upgradeOpen} reason={upgradeReason} onClose={closeUpgrade} />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">{t(lang, "controls")}</div>
            <div className="text-xs text-muted">{controlsHintBase} • {updatesHint}</div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--accent))]"></span>
                {t(lang, "liveDbFeed")}
              </span>
              <span className="opacity-60">•</span>
              <span suppressHydrationWarning>
                {t(lang, "lastLoaded")}: {last ? timeAgo(last) : "—"}
              </span>
              <button type="button" onClick={() => void refreshFeed()} disabled={feedLoading}
                aria-label={t(lang, "refreshFeed")} title={t(lang, "refreshFeed")}
                className="rounded-lg p-1.5 hover-subtle focus-ring disabled:opacity-50">
                <RefreshCw size={13} className={feedLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">

                <Segmented
                  value={days}
                  onChange={(v) => setDays(v)}
                  options={[
                    { value: 1 as const, label: t(lang, "oneDay") },
                    { value: 7 as const, label: t(lang, "sevenDays") },
                  ]}
                />
              </div>

              <Button
                variant="ghost"
                className="w-full gap-2 sm:w-auto sm:ml-auto"
                disabled={!aiSummaryEnabled}
                onClick={async () => {
                  if (!requireLogin()) return;
                  const next = !digestOpen;
                  setDigestOpen(next);
                  if (next) await ensureDigest();
                }}
                title={!aiSummaryEnabled ? "AI summary disabled" : undefined}
              >
                <Sparkles size={16} className="text-[hsl(var(--accent))]" />
                {t(lang, "aiSummary")}
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder={t(lang, "countryPlaceholder")}
                className="w-full rounded-xl border border-soft bg-subtle-2 px-3 py-2 text-sm text-[hsl(var(--fg))] placeholder:text-muted focus-ring sm:w-44"
              />
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={t(lang, "categoryPlaceholder")}
                className="w-full rounded-xl border border-soft bg-subtle-2 px-3 py-2 text-sm text-[hsl(var(--fg))] placeholder:text-muted focus-ring sm:w-52"
              />
            </div>

            {msg ? <div className="text-xs text-muted">{msg}</div> : null}
            {feedError ? <div role="alert" className="text-xs text-muted">{t(lang, "feedLoadError")}</div> : null}
            {lang !== "en" && visible && !visible.meta.translateEnabled ? <div className="text-xs text-muted">{t(lang, "translateNeedsKey")}</div> : null}
          </div>
        </div>
      </Card>

      {digestOpen ? (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{t(lang, "digestTitle")}</div>
              <div className="text-xs text-muted">{t(lang, "digestHint")}</div>
            </div>
            {digest ? (
              <SpeakButton
                text={digestSpeakText}
                lang={speechLang}
                labelSpeak={t(lang, "speak")}
                labelStop={t(lang, "stop")}
              />
            ) : null}
          </div>

          <div className="mt-3 rounded-2xl border border-soft bg-glass p-4">
            {digestLoading ? (
              <div className="text-sm text-muted">{t(lang, "generating")}</div>
            ) : digestError ? (
              <div className="text-sm text-muted">{digestError}</div>
            ) : digest ? (
              <div className="space-y-4">
                <div className="text-sm">{digest.overview}</div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-muted">{t(lang, "themes")}</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {digest.themes.map((x, idx) => (
                      <li key={idx}>{x}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-muted">{t(lang, "highlights")}</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {digest.highlights.map((x, idx) => (
                      <li key={idx}>{x}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-muted">{t(lang, "whyItMattersLabel")}</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {digest.whyItMatters.map((x, idx) => (
                      <li key={idx}>{x}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-muted">{t(lang, "watchlist")}</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {digest.watchlist.map((x, idx) => (
                      <li key={idx}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="space-y-3" aria-busy={feedLoading}>
        {!visible && feedLoading ? <div role="status" className="animate-pulse rounded-2xl border border-soft p-6 text-sm text-muted">{t(lang, "feedLoading")}</div> : null}
        {items.map((it) => {
          const open = Boolean(aiOpen[it.id]);
          const keyPoints = it.aiSummary ? extractKeyPointsFromSummary(it.aiSummary) : [];
          const mainSummary = it.aiSummary ? stripKeyPointsFromSummary(it.aiSummary) : "";
          const itemSpeakText = it.aiSummary
            ? [
                mainSummary,
                keyPoints.length
                  ? `Key points:
${keyPoints.map((p, i) => `${i + 1}) ${p}`).join("\n")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n")
            : "";
          return (
            <Card key={it.id} className="p-4">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted" suppressHydrationWarning>
                      {it.sourceName} • collected {timeAgo(it.createdAt)} • score {it.score.toFixed(2)}
                    </div>
                    <div className="mt-1 text-lg font-semibold leading-snug">{it.title}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <SpeakButton text={`${it.title}. ${it.summary}`} lang={speechLang} labelSpeak={t(lang, "speak")} labelStop={t(lang, "stop")} />
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted">{it.summary}</div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                  {it.country ? <Pill>{it.country}</Pill> : null}
                  {it.topics.slice(0, 6).map((x) => (
                    <Pill key={x}>{x}</Pill>
                  ))}
                  </div>
                  <SaveButton item={it} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <A href={it.url}>{t(lang, "openSource")}</A>

                  <Button
                    variant="ghost"
                    className="ml-auto gap-2"
                    disabled={!aiSummaryEnabled}
                    onClick={async () => {
                      if (!requireLogin()) return;
                      setAiOpen((x) => ({ ...x, [it.id]: !x[it.id] }));
                      if (!it.aiSummary) await ensureAiSummary(it.id);
                    }}
                  >
                    <Sparkles size={16} className="text-[hsl(var(--accent))]" />
                    {t(lang, "itemSummary")}
                  </Button>
                </div>

                {open ? (
                  <div className="mt-3 rounded-2xl border border-soft bg-subtle-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted">{t(lang, "itemSummary")}</div>
                      {it.aiSummary ? (
                        <SpeakButton
                          text={itemSpeakText}
                          lang={speechLang}
                          labelSpeak={t(lang, "speak")}
                          labelStop={t(lang, "stop")}
                        />
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm">
                      {aiLoading[it.id] ? t(lang, "generating") : mainSummary}
                    </div>

                    {it.aiSummary && keyPoints.length ? (
                      <div className="mt-3 rounded-xl border border-soft bg-subtle px-3 py-2">
                        <div className="text-xs font-medium text-muted">{t(lang, "keyPoints")}</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {keyPoints.map((p, idx) => (
                            <li key={idx}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}

        {items.length === 0 && !feedLoading && !feedError ? <div className="text-sm text-muted">{t(lang, "noItems")}</div> : null}
      </div>
    </div>
  );
}
