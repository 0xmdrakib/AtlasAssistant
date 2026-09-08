import { Feed } from "@/components/feed";
import { getPublicFeed } from "@/lib/public-feed";
import type { Section } from "@/lib/types";

export async function InitialFeed({ section }: { section: Section }) {
  if (!process.env.DATABASE_URL) return <Feed section={section} />;
  try {
    const initialData = await getPublicFeed(section, 1);
    return <Feed section={section} initialData={initialData} />;
  } catch {
    // The client retry stays available during a temporary database outage.
    return <Feed section={section} />;
  }
}

export function FeedSkeleton() {
  return <div role="status" aria-label="Loading feed" className="space-y-3">
    {[0, 1, 2].map((key) => <div key={key} className="animate-pulse rounded-2xl border border-soft p-5">
      <div className="h-3 w-28 rounded bg-subtle-2" />
      <div className="mt-4 h-5 w-3/4 rounded bg-subtle-2" />
      <div className="mt-3 h-3 w-full rounded bg-subtle-2" />
    </div>)}
  </div>;
}
