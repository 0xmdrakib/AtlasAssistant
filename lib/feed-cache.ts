import type { FeedPayload } from "@/lib/feed-types";
import type { Section } from "@/lib/types";

type Entry = { data: FeedPayload; receivedAt: number };
const cache = new Map<string, Entry>();
const requests = new Map<string, Promise<FeedPayload>>();
export const FEED_CACHE_MS = 30000;

export function feedCacheKey(section: Section, days: number, lang: string, account: string) {
  return JSON.stringify([section, days, lang, lang === "en" ? "public" : account]);
}

export function cachedFeed(key: string) { return cache.get(key); }

export function storeFeed(key: string, data: FeedPayload, receivedAt = Date.now()) {
  cache.delete(key);
  cache.set(key, { data, receivedAt });
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
}

export function requestFeed(key: string, section: Section, days: number, lang: string, fresh = false) {
  const requestKey = `${key}:${fresh}`;
  const pending = requests.get(requestKey);
  if (pending) return pending;
  const params = new URLSearchParams({ section, days: String(days), lang });
  if (fresh) params.set("fresh", "1");
  const request = fetch(`/api/items?${params}`, { signal: AbortSignal.timeout(60000) })
    .then(async (response) => {
      if (!response.ok) throw new Error("Feed unavailable");
      const data = await response.json() as FeedPayload;
      if (!Array.isArray(data.items)) throw new Error("Invalid feed");
      storeFeed(key, data);
      return data;
    });
  requests.set(requestKey, request);
  void request.finally(() => { if (requests.get(requestKey) === request) requests.delete(requestKey); }).catch(() => {});
  return request;
}
